// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Copyright 2026 Evermind Technologies s.r.o.

/**
 * Passing a message on.
 *
 * IMAP and SMTP have no forward operation, so a forward is a new message
 * composed here, the way a mail client composes one: the new text, then a
 * block with the original's headers and body, and the original's attachments.
 *
 * **The attachments are taken from the mailbox, not from the disk.** That is
 * why attachment_dirs does not apply to them: the setting guards files on this
 * machine against being carried off in mail, and these are already mail - the
 * same bytes as the body that would be quoted anyway. Sending them still needs
 * everything sending needs (can_send, allowed_recipients), and a draft leaves
 * the decision to the user.
 *
 * **Images the HTML shows come along with their Content-ID**, so the forwarded
 * HTML still shows them. That is decided by the cid: reference in the HTML,
 * not by the part's disposition: Gmail sends an image pasted into the text as
 * an attachment that the HTML then points at (Věrka's test, 21 October 2026). A reply's quote cannot do that (see ./quote.ts), because a
 * reply carries no attachments; a forward does.
 *
 * The caller has to have All Mail open, since the parts are downloaded from it.
 */

import type { FetchMessageObject, ImapFlow, MessageAddressObject, MessageStructureObject } from 'imapflow';

import type { ResolvedAttachment } from '../attachments.js';
import { ToolError } from '../errors.js';
import { collectAttachments, downloadText, findBodyParts, safeFilename } from './body.js';
import { escapeHtml, htmlToPlain, insideBody, plainToHtml, type Quote, type QuoteLocale } from './quote.js';

/** Which attachments go along: all of them, none, or the listed attachment ids. */
export type ForwardAttachments = boolean | string[];

export interface Forwarded {
  /** The block put under the new text, in the same shape as a quote. */
  block: Quote;
  attachments: ResolvedAttachment[];
  /** "Fwd: " and the original subject, unless it already says it is a forward. */
  subject: string;
  /** The original's thread, for checking that a draft landed in it. */
  threadId: string | null;
}

/** The fetch fields readForwarded needs. */
export const FORWARD_FETCH = { uid: true, threadId: true, envelope: true, bodyStructure: true } as const;

export async function readForwarded(
  client: ImapFlow,
  original: FetchMessageObject,
  which: ForwardAttachments,
  locale: QuoteLocale,
): Promise<Forwarded> {
  const structure = original.bodyStructure;
  const envelope = original.envelope;

  let text: string | null = null;
  let html: string | null = null;
  if (structure !== undefined) {
    const parts = findBodyParts(structure);
    text = parts.text === null ? null : await downloadText(client, original.uid, parts.text);
    html = parts.html === null ? null : await downloadText(client, original.uid, parts.html);
  }

  const header = headerLines(envelope, locale);
  const plainBody = text ?? htmlToPlain(html ?? '');
  const htmlBody = html === null ? plainToHtml(text ?? '') : insideBody(html);

  return {
    block: {
      text: `${header.map((line) => line.label + line.value).join('\n')}\n\n${plainBody}`,
      // The break keeps the header block off the last line of the signature,
      // the way Gmail spaces its own forwards.
      html: [
        '<br>',
        '<div class="gmail_quote">',
        '<div dir="ltr" class="gmail_attr">',
        header.map((line) => escapeHtml(line.label + line.value)).join('<br>'),
        '<br></div><br><br>',
        htmlBody,
        '</div>',
      ].join(''),
    },
    attachments: structure === undefined ? checkNone(which) : await downloadAttachments(client, original.uid, structure, which, html ?? ''),
    subject: forwardSubject(envelope?.subject ?? ''),
    threadId: original.threadId ?? null,
  };
}

/** "Fwd: " in front, unless the subject already starts with a forward prefix in a language Gmail users write in. */
export function forwardSubject(subject: string): string {
  return /^\s*(fwd?|fw|př|pr|tr|wg)\s*:/i.test(subject) ? subject.trim() : `Fwd: ${subject.trim()}`;
}

interface HeaderLine {
  label: string;
  value: string;
}

/** The lines Gmail puts over a forwarded message, in the language the quote line uses. */
function headerLines(envelope: FetchMessageObject['envelope'], locale: QuoteLocale): HeaderLine[] {
  const cs = locale === 'cs';
  const lines: HeaderLine[] = [{ label: cs ? '---------- Přeposlaná zpráva ---------' : '---------- Forwarded message ---------', value: '' }];
  const from = addresses(envelope?.from);
  if (from !== '') lines.push({ label: cs ? 'Od: ' : 'From: ', value: from });
  if (envelope?.date !== undefined) lines.push({ label: cs ? 'Datum: ' : 'Date: ', value: formatDate(envelope.date, locale) });
  lines.push({ label: cs ? 'Předmět: ' : 'Subject: ', value: envelope?.subject ?? '' });
  const to = addresses(envelope?.to);
  if (to !== '') lines.push({ label: cs ? 'Komu: ' : 'To: ', value: to });
  const cc = addresses(envelope?.cc);
  if (cc !== '') lines.push({ label: cs ? 'Kopie: ' : 'Cc: ', value: cc });
  return lines;
}

function addresses(list: MessageAddressObject[] | undefined): string {
  return (list ?? [])
    .map((entry) => {
      const address = entry.address ?? '';
      const name = (entry.name ?? '').trim();
      return name === '' ? address : `${name} <${address}>`;
    })
    .filter((entry) => entry !== '')
    .join(', ');
}

function formatDate(date: Date, locale: QuoteLocale): string {
  return new Intl.DateTimeFormat(locale === 'cs' ? 'cs-CZ' : 'en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: locale === 'cs' ? 'numeric' : 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function checkNone(which: ForwardAttachments): ResolvedAttachment[] {
  if (Array.isArray(which) && which.length > 0) {
    throw new ToolError('not_found', 'The message being forwarded has no attachments to choose from.');
  }
  return [];
}

async function downloadAttachments(
  client: ImapFlow,
  uid: number,
  structure: MessageStructureObject,
  which: ForwardAttachments,
  html: string,
): Promise<ResolvedAttachment[]> {
  if (which === false) {
    return [];
  }
  const available = collectAttachments(structure);
  let chosen = available;
  if (Array.isArray(which)) {
    const unknown = which.filter((id) => !available.some((candidate) => candidate.attachment_id === id));
    if (unknown.length > 0) {
      throw new ToolError(
        'not_found',
        `The message being forwarded has no attachment ${unknown.join(', ')}. Its attachments are: ` +
          (available.length === 0
            ? 'none.'
            : available.map((candidate) => `${candidate.attachment_id} (${candidate.filename ?? candidate.mime_type})`).join(', ') + '.'),
      );
    }
    chosen = available.filter((candidate) => which.includes(candidate.attachment_id));
  }

  const ids = contentIds(structure);
  const files: ResolvedAttachment[] = [];
  for (const attachment of chosen) {
    const download = await client.download(String(uid), attachment.attachment_id, { uid: true });
    const chunks: Buffer[] = [];
    for await (const chunk of download.content) {
      chunks.push(chunk as Buffer);
    }
    const cid = ids.get(attachment.attachment_id);
    files.push({
      // Untrusted, like every name out of a message: no path separators reach
      // the composer, even though nothing here writes to disk.
      filename: safeFilename(download.meta.filename ?? attachment.filename, attachment.attachment_id),
      content: Buffer.concat(chunks),
      contentType: download.meta.contentType ?? attachment.mime_type,
      ...(cid !== undefined && shownBy(html, cid) ? { cid } : {}),
    });
  }
  return files;
}

/** Whether the HTML points at this Content-ID, which is what makes the part an image in the text. */
function shownBy(html: string, cid: string): boolean {
  return html.toLowerCase().includes(`cid:${cid.toLowerCase()}`);
}

/** Content-ID of each body part that has one, without the angle brackets. */
function contentIds(structure: MessageStructureObject): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (node: MessageStructureObject): void => {
    if (node.part !== undefined && typeof node.id === 'string' && node.id.trim() !== '') {
      found.set(node.part, node.id.trim().replace(/^<|>$/g, ''));
    }
    for (const child of node.childNodes ?? []) {
      walk(child);
    }
  };
  walk(structure);
  return found;
}
