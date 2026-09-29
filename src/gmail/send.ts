// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karel Derfl

/**
 * Sending a message over SMTP, and putting a copy in Sent.
 *
 * Sending cannot be undone and it goes out under the user's own name, so this
 * module is deliberately the most guarded one here.
 *
 * **Two locks, both closed by default.** A mailbox may only send if its
 * configuration says so, and `can_send` defaults to false. If a list of
 * allowed recipients is configured, it is enforced exactly - and a list that
 * is present but empty means nowhere, not everywhere. A configuration that
 * granted sending by omission would look locked without being locked.
 *
 * **Two outcomes, reported separately.** Whether the message went out and
 * whether it can be found in Sent are different questions, and answering them
 * as one would turn a missing copy into an apparent failed send - after which
 * the message would be sent twice.
 *
 * **Gmail files the copy itself.** Unlike SMTP servers in general, Gmail saves
 * everything sent through smtp.gmail.com into Sent on its own, and there is no
 * way to switch that off. Appending a second copy would upload the message
 * twice and can make Gmail's IMAP server reject the append outright - which
 * would then be reported as a missing copy that is in fact there.
 *
 * So the copy is verified rather than written: after sending, Sent is searched
 * for the Message-ID. Only if Gmail has not filed it does the server append it
 * itself, which keeps the guarantee for any account where that behaviour ever
 * differs. The bytes appended are the bytes that were sent, because the message
 * is composed once and the same buffer goes to SMTP and to APPEND.
 */

import { createTransport } from 'nodemailer';

import { assertMessageFits, type ResolvedAttachment } from '../attachments.js';
import type { Account } from '../config.js';
import { ToolError } from '../errors.js';
import { compose, inAngleBrackets, resolveSender, resolveSignature } from './compose.js';
import { findByMessageId, searchByMessageId } from './lookup.js';
import { appendQuote, buildQuote, plainBodyToHtml, type Quote, type QuoteLocale } from './quote.js';
import { findFolder, withAllMail, withClient } from './session.js';
import { appendSignature } from './signature.js';

const GMAIL_SMTP_HOST = 'smtp.gmail.com';
const SMTP_TIMEOUT_MS = 60_000;
// How long to wait for a connection before trying the next port. Short on
// purpose: a blocked port does not refuse, it stays silent, and waiting the
// full minute on it made a failed send take over two minutes.
const SMTP_CONNECT_TIMEOUT_MS = 10_000;

export interface SendInput {
  to: string[];
  cc?: string[] | undefined;
  bcc?: string[] | undefined;
  subject: string;
  body: string;
  htmlBody?: string | undefined;
  inReplyTo?: string | undefined;
  references?: string[] | undefined;
  fromAlias?: string | undefined;
  /** Files already read and checked against the configured directories. */
  attachments?: ResolvedAttachment[] | undefined;
  /** Whether to put the quoted original under the reply. Ignored without inReplyTo. */
  quoteOriginal?: boolean | undefined;
  /** Language of the attribution line above the quote. */
  quoteLocale?: QuoteLocale | undefined;
  /** Name of the signature to end with, false for none, or undefined for the configured default. */
  signature?: string | false | undefined;
}

export interface SentCopy {
  /** Whether the message can be found in Sent. Independent of whether it was sent. */
  saved: boolean;
  /** Who put it there: Gmail on its own, or this server as a fallback. */
  filed_by: 'gmail' | 'server' | null;
  folder: string | null;
  uid: number | null;
  error: string | null;
}

export interface SendResult {
  account: string;
  from: string;
  /** Message-ID of what was sent. Use it to find the message again. */
  message_id: string | null;
  /** Recipients the server took responsibility for. */
  accepted: string[];
  /** Recipients it refused. These did NOT receive the message. */
  rejected: string[];
  /** Recipients whose outcome is not yet known. They are not retried automatically. */
  pending: string[];
  smtp_response: string;
  /** Port the message went out through - 587 when 465 could not be reached. */
  smtp_port: SmtpPort;
  sent_copy: SentCopy;
  /**
   * Names of the files that actually went with the message.
   *
   * Reported because attachments are the one thing here that takes data off
   * the machine, and the user reads this result. A list they did not expect is
   * the signal that something went out which should not have.
   */
  attachments: string[];
  /** Name of the signature the message ended with, or null when it went out unsigned. */
  signature: string | null;
  /** Whether the quoted original went out under the reply. */
  quoted: boolean;
  warning: string | null;
}

export async function sendMessage(account: Account, input: SendInput): Promise<SendResult> {
  if (!account.canSend) {
    throw new ToolError(
      'send_forbidden',
      `Mailbox "${account.name}" is not allowed to send. Sending is off unless the configuration turns it on ` +
        'for that mailbox, because a default that allowed it would look locked without being locked.',
    );
  }
  if (input.to.length === 0) {
    throw new ToolError('send_forbidden', 'A message needs at least one recipient in "to".');
  }

  const recipients = [...input.to, ...(input.cc ?? []), ...(input.bcc ?? [])];
  assertRecipientsAllowed(account, recipients);

  // Checked before the message is built, so writing as an address the mailbox
  // has no claim to fails while nothing has left the machine.
  const sender = resolveSender(account, input.fromAlias);
  const signature = resolveSignature(account, sender.alias, input.signature);
  const from = sender.from;
  const inReplyTo = input.inReplyTo === undefined ? null : inAngleBrackets(input.inReplyTo);
  const references = (input.references ?? []).map(inAngleBrackets);
  if (inReplyTo !== null && references.length === 0) {
    references.push(inReplyTo);
  }

  // Read before anything goes out, so a mailbox that cannot be opened stops
  // the send rather than sending a reply with the history silently missing.
  const quote =
    input.quoteOriginal === true && input.inReplyTo !== undefined
      ? await fetchQuote(account, input.inReplyTo, input.quoteLocale ?? 'cs')
      : null;
  // Both halves always go out. Without this a message written as plain text
  // would lose the HTML signature - logo and all - and would look unlike
  // everything else the mailbox sends, with nothing saying so.
  const htmlBody = input.htmlBody ?? plainBodyToHtml(input.body);
  const signed = appendSignature(input.body, htmlBody, signature);
  const quoted = appendQuote(signed.body, signed.htmlBody, quote);

  const composed = await compose({
    from,
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    body: quoted.body,
    htmlBody: quoted.htmlBody,
    inReplyTo,
    references,
    attachments: input.attachments,
  });

  // Checked on the assembled bytes rather than on the files, because that is
  // what Gmail measures. Refusing here means nothing was sent; letting SMTP
  // refuse it would tell the user only after they believed it had gone.
  assertMessageFits(composed.raw.length, input.attachments?.length ?? 0);

  const delivery = await deliver(account, from, recipients, composed.raw);

  // Nothing was delivered, so there is nothing to file. Reported as a failure
  // rather than as a result with an empty accepted list, which would read as
  // success to anything glancing at it.
  if (delivery.accepted.length === 0) {
    throw new ToolError(
      'upstream_error',
      `The message was not delivered to any recipient from mailbox "${account.name}". ` +
        `Gmail said: ${delivery.response}`,
    );
  }

  const sentCopy = await ensureSentCopy(account, composed.messageId, composed.raw);

  return {
    account: account.name,
    from,
    message_id: composed.messageId,
    accepted: delivery.accepted,
    rejected: delivery.rejected,
    pending: delivery.pending,
    smtp_response: delivery.response,
    smtp_port: delivery.port,
    sent_copy: sentCopy,
    attachments: (input.attachments ?? []).map((file) => file.filename),
    signature: signature?.name ?? null,
    quoted: quote !== null,
    warning: warningFor(
      delivery,
      sentCopy,
      input.quoteOriginal === true && input.inReplyTo !== undefined,
      quote !== null,
    ),
  };
}

/**
 * The quote of the message being answered, read over its own connection.
 *
 * Sending does not otherwise open IMAP before the message goes out, so this is
 * a connection the send would not need. It is worth it: the alternative is
 * composing the reply from what the caller remembered of the original, which
 * is the whole text again in a second place, and wrong the moment the two
 * disagree.
 */
async function fetchQuote(account: Account, inReplyTo: string, locale: QuoteLocale): Promise<Quote | null> {
  return withAllMail(account, async ({ client }) => {
    const found = await findByMessageId(client, account, inReplyTo);
    const original = await client.fetchOne(
      String(found.uid),
      { uid: true, envelope: true, bodyStructure: true },
      { uid: true },
    );
    return original === false ? null : buildQuote(client, original, locale);
  });
}

/**
 * Port that worked for a mailbox in this process, so the probe runs once per
 * mailbox and not before every message.
 */
const workingPort = new Map<string, SmtpPort>();

export type SmtpPort = 465 | 587;

function smtpTransport(port: SmtpPort, account: Account) {
  return createTransport({
    host: GMAIL_SMTP_HOST,
    port,
    // 465 speaks TLS from the first byte; 587 starts in plain text and must be
    // upgraded with STARTTLS before the password goes over it.
    secure: port === 465,
    requireTLS: port === 587,
    auth: { user: account.address, pass: account.password },
    connectionTimeout: SMTP_CONNECT_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
  });
}

export type SmtpProbe =
  | { ok: true; port: SmtpPort }
  | { ok: false; code: 'auth_failed' | 'upstream_error'; message: string };

/**
 * Find a port the mailbox can send through: connect and log in, send nothing.
 *
 * The port is chosen here and never by a failed send. nodemailer tags socket
 * errors and timeouts with the CONN command at any stage, even in the middle
 * of a message Gmail may already have accepted, so falling back to another
 * port after a failed send could deliver the message twice. A probe that fails
 * has sent nothing, so trying the next port after it is always safe.
 */
export async function probeSmtp(account: Account): Promise<SmtpProbe> {
  const ports: SmtpPort[] = account.smtpPort === null ? [465, 587] : [account.smtpPort];
  const unreachable: string[] = [];
  for (const port of ports) {
    const transport = smtpTransport(port, account);
    try {
      await transport.verify();
      workingPort.set(account.name, port);
      return { ok: true, port };
    } catch (error) {
      const e = error as { code?: string; response?: string; message?: string };
      if (e.code === 'EAUTH') {
        // A wrong or revoked app password fails on every port alike.
        return { ok: false, code: 'auth_failed', message: e.response ?? e.message ?? 'authentication failed' };
      }
      unreachable.push(`${GMAIL_SMTP_HOST}:${port} (${e.message ?? String(error)})`);
    } finally {
      transport.close();
    }
  }
  return {
    ok: false,
    code: 'upstream_error',
    message:
      `Could not connect to Gmail to send from mailbox "${account.name}": ${unreachable.join(', ')}. ` +
      'The network or hosting provider most likely blocks outgoing SMTP; ' +
      (account.smtpPort === null
        ? 'ask the provider or network administrator to allow port 587 or 465.'
        : `set smtp_port to the other port (465 or 587) in the configuration, or ask the provider to allow port ${account.smtpPort}.`),
  };
}

interface Delivery {
  accepted: string[];
  rejected: string[];
  pending: string[];
  response: string;
  port: SmtpPort;
}

/** nodemailer error codes that mean the connection broke, not that Gmail said no. */
const CONNECTION_ERRORS = ['ETIMEDOUT', 'ESOCKET', 'ECONNECTION', 'EDNS', 'ETLS'];

async function deliver(account: Account, from: string, recipients: string[], raw: Buffer): Promise<Delivery> {
  let port = account.smtpPort ?? workingPort.get(account.name) ?? null;
  if (port === null) {
    const probe = await probeSmtp(account);
    if (!probe.ok) {
      throw new ToolError(probe.code, `${probe.message} Nothing was sent.`);
    }
    port = probe.port;
  }

  const transport = smtpTransport(port, account);
  try {
    // The pre-built message goes out as it is, so the envelope has to be given
    // explicitly - nothing re-reads the headers to work out who it is for.
    const info = (await transport.sendMail({
      envelope: { from, to: recipients },
      raw,
    })) as unknown as {
      accepted?: Array<string | { address?: string }>;
      rejected?: Array<string | { address?: string }>;
      pending?: Array<string | { address?: string }>;
      response?: string;
    };

    return {
      accepted: toAddresses(info.accepted),
      rejected: toAddresses(info.rejected),
      pending: toAddresses(info.pending),
      response: info.response ?? '',
      port,
    };
  } catch (error) {
    const e = error as { code?: string; message?: string };
    const detail = e.message ?? String(error);
    if (CONNECTION_ERRORS.includes(e.code ?? '')) {
      // The port may have stopped working; probe again next time.
      workingPort.delete(account.name);
      throw new ToolError(
        'upstream_error',
        `The connection to Gmail (port ${port}) broke while sending from mailbox "${account.name}": ${detail}. ` +
          'The message may or may not have been sent. Check the Sent folder before trying again - ' +
          'sending again without checking can deliver it twice.',
      );
    }
    throw new ToolError('upstream_error', `Gmail refused the message from mailbox "${account.name}": ${detail}`);
  } finally {
    transport.close();
  }
}

/**
 * Confirm the message is in Sent, and file it only if Gmail has not.
 *
 * Gmail saves it as part of the SMTP transaction, but not always by the time
 * this runs, so the search is retried briefly before falling back to an
 * append. A failure here does not undo the send and must never be reported as
 * one, so everything is caught and handed back as part of the result.
 */
const SENT_LOOKUP_DELAYS_MS = [0, 1_000, 2_000];

async function ensureSentCopy(account: Account, messageId: string | null, raw: Buffer): Promise<SentCopy> {
  try {
    return await withClient(account, async (client) => {
      const sent = await findFolder(client, 'sent');

      if (messageId !== null) {
        const lock = await client.getMailboxLock(sent.path, { readOnly: true });
        try {
          for (const delay of SENT_LOOKUP_DELAYS_MS) {
            if (delay > 0) {
              await new Promise((resolve) => setTimeout(resolve, delay));
            }
            const found = await searchByMessageId(client, messageId);
            if (found.length > 0) {
              return {
                saved: true,
                filed_by: 'gmail' as const,
                folder: sent.path,
                uid: Math.max(...found),
                error: null,
              };
            }
          }
        } finally {
          lock.release();
        }
      }

      // Gmail did not file it, or there was no Message-ID to look for. Append
      // the exact bytes that were sent.
      const appended = await client.append(sent.path, raw, ['\\Seen']);
      if (appended === false) {
        return {
          saved: false,
          filed_by: null,
          folder: sent.path,
          uid: null,
          error: 'Gmail neither filed the message itself nor accepted a copy.',
        };
      }
      return {
        saved: true,
        filed_by: 'server' as const,
        folder: sent.path,
        uid: appended.uid ?? null,
        error: null,
      };
    });
  } catch (error) {
    return {
      saved: false,
      filed_by: null,
      folder: null,
      uid: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function warningFor(
  delivery: Delivery,
  sentCopy: SentCopy,
  quoteAsked: boolean,
  quoteMade: boolean,
): string | null {
  const notes: string[] = [];
  if (quoteAsked && !quoteMade) {
    notes.push(
      'The message went out with no quoted history: the message it answers has no readable body to quote. ' +
        'The recipient has the new text alone.',
    );
  }
  if (delivery.rejected.length > 0) {
    notes.push(
      `The message did NOT reach ${delivery.rejected.join(', ')}. Those recipients were refused while the others went through.`,
    );
  }
  if (delivery.pending.length > 0) {
    notes.push(
      `The outcome for ${delivery.pending.join(', ')} is not known and will not be retried automatically.`,
    );
  }
  if (!sentCopy.saved) {
    notes.push(
      'The message was sent but cannot be found in the Sent folder, so it will not show up there or in a later ' +
        'pass over the mailbox. The send itself stands and must NOT be repeated.',
    );
  }
  return notes.length === 0 ? null : notes.join(' ');
}

/**
 * Check every recipient against the configured allowlist.
 *
 * An entry is either a full address or a domain written as "@example.com".
 * A list that is configured but empty allows nobody; that is the point of it.
 * No list at all means the mailbox-level `can_send` is the only gate.
 */
function assertRecipientsAllowed(account: Account, recipients: string[]): void {
  const allowed = account.allowedRecipients;
  if (allowed === null) {
    return;
  }

  const refused = recipients.filter((recipient) => !isAllowed(recipient, allowed));
  if (refused.length > 0) {
    throw new ToolError(
      'send_forbidden',
      `Mailbox "${account.name}" may not send to ${refused.join(', ')}. ` +
        (allowed.length === 0
          ? 'Its allowed_recipients list is empty, which allows nobody.'
          : `Its allowed_recipients list holds: ${allowed.join(', ')}.`),
    );
  }
}

/**
 * A domain rule matches only the domain itself, never a subdomain and never a
 * lookalike: "@partner.example" allows "a@partner.example" but not
 * "a@evil-partner.example" nor "a@sub.partner.example". Narrow on purpose,
 * because widening a rule is a decision and should be written down.
 */
export function isAllowed(recipient: string, allowed: string[]): boolean {
  const address = recipient.trim().toLowerCase();
  return allowed.some((entry) => {
    const rule = entry.trim().toLowerCase();
    return rule.startsWith('@') ? address.endsWith(rule) : address === rule;
  });
}

function toAddresses(values: Array<string | { address?: string }> | undefined): string[] {
  return (values ?? []).map((value) => (typeof value === 'string' ? value : (value.address ?? ''))).filter((value) => value !== '');
}
