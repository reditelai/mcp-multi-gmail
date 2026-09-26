// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karel Derfl

/**
 * Reading one message: its headers, a window of its body, and what is attached.
 *
 * The body is returned in windows because on a long thread every reply carries
 * the quoted history, so the text grows into hundreds of kilobytes. The window
 * is always reported alongside the total, so a caller can tell a short message
 * from the first page of a long one.
 *
 * **Quoted history is not a source of context.** It is usually in a reply but
 * it is not guaranteed - mobile clients cut it off, attachments are never
 * quoted, and nothing in it says what is missing. The structure of a
 * conversation comes from the thread, never from the quotes inside a message.
 */

import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { ImapFlow, MessageStructureObject } from 'imapflow';

import type { Account } from '../config.js';
import { ToolError } from '../errors.js';
import { findByMessageId } from './lookup.js';
import { toMessageSummary, type MessageSummary } from './message.js';
import { withAllMail } from './session.js';

const DEFAULT_MAX_BODY_LENGTH = 8_000;
const HIGHEST_MAX_BODY_LENGTH = 200_000;

export interface AttachmentInfo {
  /** IMAP body part number. Valid for this message; pass it to mg_get_attachment. */
  attachment_id: string;
  filename: string | null;
  mime_type: string;
  size_bytes: number | null;
  /** True for a part shown inside the message, such as an embedded image, rather than a file added to it. */
  inline: boolean;
}

export interface MessageDetail extends MessageSummary {
  /** Which part the body was taken from: the plain text part when there is one, otherwise HTML. */
  body_format: 'text' | 'html' | null;
  body: string | null;
  /** Where this window starts, counted in characters of the decoded text. */
  body_offset: number;
  /** Total length of the decoded text, so a caller knows how much is left. */
  body_total_length: number;
  /** True when the text continues past this window. */
  body_truncated: boolean;
  attachments: AttachmentInfo[];
  /** How many copies of this Message-ID the mailbox holds. Normally 1. */
  copies: number;
}

export async function getMessage(
  account: Account,
  messageId: string,
  bodyOffset = 0,
  maxBodyLength = DEFAULT_MAX_BODY_LENGTH,
): Promise<MessageDetail> {
  const offset = Math.max(Math.trunc(bodyOffset), 0);
  const limit = Math.min(Math.max(Math.trunc(maxBodyLength), 1), HIGHEST_MAX_BODY_LENGTH);

  return withAllMail(account, async ({ client }) => {
    const found = await findByMessageId(client, account, messageId);
    const message = await client.fetchOne(
      String(found.uid),
      {
        uid: true,
        threadId: true,
        internalDate: true,
        envelope: true,
        labels: true,
        flags: true,
        size: true,
        bodyStructure: true,
      },
      { uid: true },
    );
    if (message === false) {
      throw new ToolError('not_found', `The message disappeared from mailbox "${account.name}" while being read.`);
    }

    const summary = toMessageSummary(account, message);
    const structure = message.bodyStructure;
    const textPart = structure === undefined ? null : findTextPart(structure);
    const attachments = structure === undefined ? [] : collectAttachments(structure);

    let body: string | null = null;
    let total = 0;
    if (textPart !== null) {
      const decoded = await downloadText(client, found.uid, textPart.part);
      total = decoded.length;
      body = decoded.slice(offset, offset + limit);
    }

    return {
      ...summary,
      body_format: textPart?.format ?? null,
      body,
      body_offset: offset,
      body_total_length: total,
      body_truncated: body !== null && offset + body.length < total,
      attachments,
      copies: found.copies,
    };
  });
}

export interface SavedAttachment {
  account: string;
  message_id: string;
  attachment_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  /** Where the file was written. The content is not returned inline. */
  path: string;
}

/**
 * Write one attachment to disk and report where it landed.
 *
 * The bytes are not returned inline: an attachment is routinely megabytes, and
 * putting that through a tool response is useless to the caller and expensive
 * for everyone.
 */
export async function saveAttachment(
  account: Account,
  messageId: string,
  attachmentId: string,
  downloadDir: string,
): Promise<SavedAttachment> {
  return withAllMail(account, async ({ client }) => {
    const found = await findByMessageId(client, account, messageId);
    const message = await client.fetchOne(String(found.uid), { uid: true, bodyStructure: true }, { uid: true });
    if (message === false || message.bodyStructure === undefined) {
      throw new ToolError('not_found', `The message could not be read from mailbox "${account.name}".`);
    }

    const wanted = collectAttachments(message.bodyStructure).find(
      (candidate) => candidate.attachment_id === attachmentId,
    );
    if (wanted === undefined) {
      throw new ToolError(
        'not_found',
        `That message has no attachment "${attachmentId}". Attachment ids come from mg_get_message and belong ` +
          'to the message they were listed for.',
      );
    }

    const download = await client.download(String(found.uid), attachmentId, { uid: true });
    await mkdir(downloadDir, { recursive: true });

    // The filename comes out of the message, so it is treated as untrusted:
    // only the last path segment is kept and separators are stripped, or a
    // message could otherwise name a path outside the download directory.
    const safeName = safeFilename(download.meta.filename ?? wanted.filename, attachmentId);
    const target = resolve(join(downloadDir, safeName));
    if (!target.startsWith(resolve(downloadDir))) {
      throw new ToolError('upstream_error', 'The attachment filename does not resolve inside the download directory.');
    }

    let written = 0;
    download.content.on('data', (chunk: Buffer) => {
      written += chunk.length;
    });
    await pipeline(download.content, createWriteStream(target));

    return {
      account: account.name,
      message_id: messageId,
      attachment_id: attachmentId,
      filename: safeName,
      mime_type: download.meta.contentType ?? wanted.mime_type,
      size_bytes: written,
      path: target,
    };
  });
}

interface TextPart {
  part: string;
  format: 'text' | 'html';
}

export interface BodyParts {
  /** IMAP part number of the plain text body, or null when the message has none. */
  text: string | null;
  /** IMAP part number of the HTML body, or null when the message has none. */
  html: string | null;
}

/**
 * Both body parts of a message, rather than the better of the two.
 *
 * Reading a message wants one part - the plain one where there is a choice.
 * Quoting wants both, because the quote goes into a message that has a plain
 * and an HTML side and each side has to be built from its own source. Taking
 * the plain text and escaping it into the HTML side would throw away the
 * formatting of the original in a reply that shows it back to its own author.
 */
export function findBodyParts(structure: MessageStructureObject): BodyParts {
  const parts: BodyParts = { text: null, html: null };

  const consider = (node: MessageStructureObject): void => {
    if (node.part === undefined) {
      return;
    }
    // A part the sender attached is a file that happens to be text, not the
    // body of the message.
    if ((node.disposition ?? '').toLowerCase() === 'attachment') {
      return;
    }
    const type = node.type.toLowerCase();
    if (type === 'text/plain' && parts.text === null) {
      parts.text = node.part;
    }
    if (type === 'text/html' && parts.html === null) {
      parts.html = node.part;
    }
  };

  const walk = (node: MessageStructureObject): void => {
    consider(node);
    for (const child of node.childNodes ?? []) {
      walk(child);
    }
  };

  // A message that is a single text part has no part number of its own; IMAP
  // addresses its body as part 1. The same rule findTextPart follows.
  if (structure.childNodes === undefined && structure.part === undefined) {
    const type = structure.type.toLowerCase();
    if (type === 'text/plain') {
      return { text: '1', html: null };
    }
    if (type === 'text/html') {
      return { text: null, html: '1' };
    }
    return parts;
  }

  walk(structure);
  return parts;
}

/**
 * Prefer the plain text part and fall back to HTML.
 *
 * Plain text is what a reader wants; HTML is returned as-is rather than
 * converted, because a conversion that drops content silently is worse than
 * markup the caller can see.
 */
export function findTextPart(structure: MessageStructureObject): TextPart | null {
  let html: TextPart | null = null;

  const walk = (node: MessageStructureObject): TextPart | null => {
    const type = node.type.toLowerCase();
    const isAttachment = (node.disposition ?? '').toLowerCase() === 'attachment';
    if (node.part !== undefined && !isAttachment) {
      if (type === 'text/plain') {
        return { part: node.part, format: 'text' };
      }
      if (type === 'text/html' && html === null) {
        html = { part: node.part, format: 'html' };
      }
    }
    for (const child of node.childNodes ?? []) {
      const found = walk(child);
      if (found !== null) {
        return found;
      }
    }
    return null;
  };

  // A message that is a single text part has no part number of its own; IMAP
  // addresses its body as part 1.
  if (structure.childNodes === undefined && structure.part === undefined) {
    const type = structure.type.toLowerCase();
    if (type === 'text/plain') {
      return { part: '1', format: 'text' };
    }
    if (type === 'text/html') {
      return { part: '1', format: 'html' };
    }
    return null;
  }

  return walk(structure) ?? html;
}

export function collectAttachments(structure: MessageStructureObject): AttachmentInfo[] {
  const found: AttachmentInfo[] = [];

  const walk = (node: MessageStructureObject): void => {
    const disposition = (node.disposition ?? '').toLowerCase();
    const filename = node.dispositionParameters?.['filename'] ?? node.parameters?.['name'] ?? null;
    const isLeaf = (node.childNodes ?? []).length === 0;

    if (node.part !== undefined && isLeaf && (disposition === 'attachment' || disposition === 'inline' || filename !== null)) {
      const type = node.type.toLowerCase();
      // A plain text or HTML part with no filename is the message body, not
      // something attached to it.
      if (filename !== null || (type !== 'text/plain' && type !== 'text/html')) {
        found.push({
          attachment_id: node.part,
          filename,
          mime_type: node.type,
          size_bytes: node.size ?? null,
          inline: disposition === 'inline',
        });
      }
    }
    for (const child of node.childNodes ?? []) {
      walk(child);
    }
  };

  walk(structure);
  return found;
}

/**
 * Download a body part and decode it to text.
 *
 * ImapFlow undoes the transfer encoding but reports the charset rather than
 * converting it, and Czech mail still arrives in windows-1250 and iso-8859-2.
 * Decoding by the declared charset is what keeps the diacritics; a failure to
 * recognise the charset falls back to UTF-8 rather than throwing, because
 * mangled text is still readable and a missing body is not.
 */
export async function downloadText(client: ImapFlow, uid: number, part: string): Promise<string> {
  const download = await client.download(String(uid), part, { uid: true });
  const chunks: Buffer[] = [];
  for await (const chunk of download.content) {
    chunks.push(chunk as Buffer);
  }
  const buffer = Buffer.concat(chunks);
  const charset = download.meta.charset ?? 'utf-8';
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return buffer.toString('utf8');
  }
}

export function safeFilename(filename: string | null, fallback: string): string {
  const fallbackName = `part-${fallback.replace(/[^0-9.]/g, '')}.bin`;
  if (filename === null || filename.trim() === '') {
    return fallbackName;
  }
  // Only the last path segment is kept, split on both separators rather than
  // with path.basename: basename follows the host platform, so the same
  // message would be handled one way on Windows and another on Linux, and a
  // filename out of an e-mail is untrusted input that should not depend on
  // where the server happens to run.
  // The second separator is the backslash, written as the escape \u005c so that
  // no layer of quoting can turn it into something else.
  const separators = ['/', '\u005c'];
  const segments = separators.reduce<string[]>(
    (parts, separator) => parts.flatMap((part) => part.split(separator)),
    [filename],
  );
  const lastSegment = segments[segments.length - 1] ?? '';

  // Every Windows reserved character and every control character becomes an
  // underscore. Written as a character check rather than a regular expression
  // so the rejected set is readable.
  const forbidden = String.raw`\/:*?"<>|`;
  const stripped = [...lastSegment]
    .map((char) => ((char.codePointAt(0) ?? 0) < 0x20 || forbidden.includes(char) ? '_' : char))
    .join('')
    .trim();
  return stripped === '' || stripped === '.' || stripped === '..' ? fallbackName : stripped;
}
