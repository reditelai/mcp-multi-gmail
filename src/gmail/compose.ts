// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karel Derfl

/**
 * Building a message.
 *
 * The same bytes are used whether the message is stored as a draft or sent and
 * then copied into Sent. Composing twice would risk the copy in Sent differing
 * from what the recipient actually received - a different Message-ID or a
 * different boundary is enough to make the two impossible to match up later.
 */

import { createTransport } from 'nodemailer';

import type { ResolvedAttachment } from '../attachments.js';
import type { Account } from '../config.js';
import { ToolError } from '../errors.js';
import { normaliseMessageId } from './lookup.js';
import type { Alias, Signature } from './signature.js';

export interface ComposeInput {
  from: string;
  to: string[];
  cc?: string[] | undefined;
  bcc?: string[] | undefined;
  subject: string;
  body: string;
  htmlBody?: string | undefined;
  /** Already wrapped in angle brackets, or null. */
  inReplyTo: string | null;
  /** Already wrapped in angle brackets. */
  references: string[];
  /**
   * Files already read from disk and checked against the configured
   * directories. Checking belongs to attachments.ts, not here: by this point a
   * file is content and a name, and composing has no business deciding whether
   * it was allowed to be read.
   */
  attachments?: ResolvedAttachment[] | undefined;
}

export interface ComposedMessage {
  raw: Buffer;
  messageId: string | null;
}

export async function compose(input: ComposeInput): Promise<ComposedMessage> {
  // A stream transport builds the message and hands it back instead of
  // delivering it: correct MIME, correct encoding of non-ASCII headers, and
  // nothing leaving the machine. CRLF line endings, because that is what both
  // IMAP APPEND and SMTP expect.
  const transport = createTransport({ streamTransport: true, buffer: true, newline: 'windows' });

  const info = (await transport.sendMail({
    from: input.from,
    to: input.to,
    ...(input.cc === undefined ? {} : { cc: input.cc }),
    ...(input.bcc === undefined ? {} : { bcc: input.bcc }),
    subject: input.subject,
    text: input.body,
    ...(input.htmlBody === undefined ? {} : { html: input.htmlBody }),
    ...(input.inReplyTo === null ? {} : { inReplyTo: input.inReplyTo }),
    ...(input.references.length === 0 ? {} : { references: input.references }),
    // Content rather than a path, so nodemailer never touches the filesystem
    // itself - everything it gets has already been through the directory check.
    ...(input.attachments === undefined || input.attachments.length === 0
      ? {}
      : { attachments: input.attachments.map((file) => ({ filename: file.filename, content: file.content })) }),
  })) as unknown as { messageId?: string; message?: Buffer };

  if (info.message === undefined) {
    throw new ToolError('upstream_error', 'The message could not be composed.');
  }

  return {
    raw: info.message,
    messageId: info.messageId === undefined ? null : normaliseMessageId(info.messageId),
  };
}

/** Wrap a Message-ID in the angle brackets the headers need, accepting it either way. */
export function inAngleBrackets(messageId: string): string {
  return `<${normaliseMessageId(messageId)}>`;
}

export interface Sender {
  /** The From header, with the display name where the alias has one. */
  from: string;
  /** The alias being written as, or null for the mailbox's own address. */
  alias: Alias | null;
}

/**
 * Work out which address the message goes out from.
 *
 * An alias has to be listed in the configuration. Gmail would refuse an
 * unverified one anyway, but that is not the reason: which addresses a mailbox
 * writes as is a decision belonging to whoever set it up, and an address that
 * is merely not forbidden is not the same as one that is allowed.
 */
export function resolveSender(account: Account, fromAlias: string | undefined): Sender {
  if (fromAlias === undefined) {
    return { from: account.address, alias: null };
  }

  const wanted = fromAlias.trim().toLowerCase();
  if (wanted === account.address.toLowerCase()) {
    return { from: account.address, alias: null };
  }

  const alias = account.aliases.find((candidate) => candidate.address.toLowerCase() === wanted);
  if (alias === undefined) {
    throw new ToolError(
      'send_forbidden',
      `Mailbox "${account.name}" may not write as ${fromAlias}. ` +
        (account.aliases.length === 0
          ? 'It has no aliases configured, so it writes only as its own address.'
          : `Its aliases are: ${account.aliases.map((candidate) => candidate.address).join(', ')}.`),
    );
  }

  return {
    from: alias.name === null ? alias.address : `"${alias.name.replace(/"/g, '')}" <${alias.address}>`,
    alias,
  };
}

/**
 * Work out which signature to end the message with.
 *
 * `false` means the caller asked for none. A name that is not configured is an
 * error rather than a message quietly going out unsigned: a signature is what
 * tells the recipient who is writing, and the caller believed it was there.
 */
export function resolveSignature(
  account: Account,
  alias: Alias | null,
  wanted: string | false | undefined,
): Signature | null {
  if (wanted === false) {
    return null;
  }

  const name = wanted ?? alias?.defaultSignature ?? account.defaultSignature;
  if (name === null || name === undefined) {
    return null;
  }

  const signature = account.signatures[name];
  if (signature === undefined) {
    const configured = Object.keys(account.signatures);
    throw new ToolError(
      'not_found',
      `Mailbox "${account.name}" has no signature called "${name}". ` +
        (configured.length === 0
          ? 'It has no signatures configured.'
          : `It has: ${configured.join(', ')}.`),
    );
  }
  return signature;
}
