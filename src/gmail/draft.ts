// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Copyright 2026 Evermind Technologies s.r.o.

/**
 * Saving a draft into the Drafts folder, and listing what is in there.
 *
 * Saving is a pure IMAP operation: the message is composed locally and put
 * into the folder with APPEND. Nothing is sent and no SMTP connection is
 * opened - sending is a separate tool with a separate lock on it.
 *
 * A draft written as a reply has to stay in its thread. Gmail joins it by the
 * In-Reply-To and References headers, and when those do not do their job the
 * draft becomes a separate message that will go out on its own. That is not
 * something to find out later, so the thread the draft landed in is read back
 * and compared with the thread it was meant for.
 *
 * The listing repeats that check rather than trusting the one made when the
 * draft was stored. A draft can come loose from its thread afterwards - an
 * edit in another client is enough - and a loose draft looks entirely ordinary
 * in a listing right up to the moment it goes out as a message of its own.
 */

import type { FetchMessageObject, ImapFlow } from 'imapflow';

import { assertMessageFits, type ResolvedAttachment } from '../attachments.js';
import type { Account } from '../config.js';
import { ToolError } from '../errors.js';
import { appendAsRead, type StoredAsRead } from './append.js';
import { compose, inAngleBrackets, resolveSender, resolveSignature } from './compose.js';
import { FORWARD_FETCH, readForwarded, type ForwardAttachments, type Forwarded } from './forward.js';
import { findByMessageId, normaliseMessageId, searchByMessageId } from './lookup.js';
import { toMessageSummary, type MessageSummary } from './message.js';
import { appendQuote, buildQuote, plainBodyToHtml, type Quote, type QuoteLocale } from './quote.js';
import { assertForwardInput } from './send.js';
import { findFolder, withClient } from './session.js';
import { appendSignature } from './signature.js';
import { trashMessage } from './trash.js';

export interface DraftInput {
  to: string[];
  cc?: string[] | undefined;
  bcc?: string[] | undefined;
  /** Required unless forwarding, where it defaults to "Fwd: " and the original subject. */
  subject?: string | undefined;
  body: string;
  htmlBody?: string | undefined;
  /** Message-ID of the message being replied to, with or without angle brackets. */
  inReplyTo?: string | undefined;
  references?: string[] | undefined;
  /** Message-ID of a message to pass on. Excludes inReplyTo. */
  forwardOf?: string | undefined;
  /** Which of its attachments go along. All of them when omitted. */
  forwardAttachments?: ForwardAttachments | undefined;
  /** Message-ID of a draft this one replaces. It goes to Trash once the new one is stored. */
  replaces?: string | undefined;
  /** A From address other than the mailbox's own. Must already be a verified alias in Gmail. */
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

export interface DraftSaved {
  account: string;
  folder: string;
  /** Message-ID of the draft itself, stable and usable to find it again. */
  message_id: string | null;
  /** UID in the Drafts folder, if the server reported one. A working identifier, not a reference to keep. */
  uid: number | null;
  from: string;
  to: string[];
  /** Thread the draft ended up in, read back after the append. */
  thread_id: string | null;
  /**
   * For a reply: whether the draft actually landed in the thread it answers.
   * null when it was not a reply, so there was no thread to join.
   */
  joined_thread: boolean | null;
  /** Names of the files attached to the draft. Reported for the same reason as on a sent message. */
  attachments: string[];
  /** Name of the signature the draft ends with, or null when it is unsigned. */
  signature: string | null;
  /**
   * Whether the quoted original was put under the reply. False when it was not
   * asked for, and also when there was nothing to quote - so a reply that was
   * meant to carry history and does not can be told apart from one that was not.
   */
  quoted: boolean;
  /** Whether this is a forward, with the original's headers and body under the new text. */
  forwarded: boolean;
  /**
   * With replaces: whether the old draft went to Trash. False means both are
   * in Drafts now. Null when nothing was being replaced.
   */
  replaced: boolean | null;
  /** Set when something is worth knowing about the result rather than failing on it. */
  warning: string | null;
}

export async function saveDraft(account: Account, input: DraftInput): Promise<DraftSaved> {
  if (input.to.length === 0) {
    throw new ToolError('not_found', 'A draft needs at least one recipient in "to".');
  }
  assertForwardInput(input.forwardOf, input.inReplyTo, input.subject);

  // Both are worked out before anything is opened, so a wrong alias or a
  // signature that is not configured stops here rather than after a draft is
  // already in the folder.
  const sender = resolveSender(account, input.fromAlias);
  const signature = resolveSignature(account, sender.alias, input.signature);
  const from = sender.from;
  const threadsWith = input.forwardOf ?? input.inReplyTo;
  const inReplyTo = threadsWith === undefined ? null : inAngleBrackets(threadsWith);
  const references = (input.references ?? []).map(inAngleBrackets);
  // A reply with no References at all still belongs to the thread it answers,
  // so the message being replied to is the reference.
  if (inReplyTo !== null && references.length === 0) {
    references.push(inReplyTo);
  }

  // Whether the draft being replaced was a reply or a forward, so a correction
  // that forgot to say so again can be told apart from one that never was.
  let replacedThreaded = false;
  const saved = await withClient(account, async (client) => {
    // The draft being replaced has to be one, and in this mailbox, before
    // anything is stored: finding out afterwards would leave a second draft
    // and an error about the first.
    if (input.replaces !== undefined) {
      const drafts = await findFolder(client, 'drafts');
      const lock = await client.getMailboxLock(drafts.path, { readOnly: true });
      try {
        const uids = await searchByMessageId(client, input.replaces);
        if (uids.length === 0) {
          throw new ToolError(
            'not_found',
            `There is no draft <${normaliseMessageId(input.replaces)}> in "${drafts.path}" of mailbox ` +
              `"${account.name}". mg_list_drafts lists the drafts with their Message-IDs. Nothing was saved.`,
          );
        }
        const old = await client.fetchOne(String(Math.max(...uids)), { uid: true, envelope: true }, { uid: true });
        replacedThreaded = old !== false && (old.envelope?.inReplyTo ?? '').trim() !== '';
      } finally {
        lock.release();
      }
    }

    // The thread the reply is meant for, looked up before the draft exists so
    // there is something to compare the result against. The same fetch brings
    // back what the quote is built from, because it is the same message.
    let expectedThreadId: string | null = null;
    let quote: Quote | null = null;
    let forwarded: Forwarded | null = null;
    if (input.forwardOf !== undefined) {
      const allMail = await findFolder(client, 'all');
      const lock = await client.getMailboxLock(allMail.path, { readOnly: true });
      try {
        const found = await findByMessageId(client, account, input.forwardOf);
        const original = await client.fetchOne(String(found.uid), FORWARD_FETCH, { uid: true });
        if (original === false) {
          throw new ToolError('not_found', `The message to forward disappeared from mailbox "${account.name}" while being read.`);
        }
        forwarded = await readForwarded(client, original, input.forwardAttachments ?? true, input.quoteLocale ?? 'cs');
        expectedThreadId = forwarded.threadId;
      } finally {
        lock.release();
      }
    } else if (input.inReplyTo !== undefined) {
      const allMail = await findFolder(client, 'all');
      const lock = await client.getMailboxLock(allMail.path, { readOnly: true });
      try {
        const found = await findByMessageId(client, account, input.inReplyTo);
        const original = await client.fetchOne(
          String(found.uid),
          { uid: true, threadId: true, envelope: true, bodyStructure: true },
          { uid: true },
        );
        if (original !== false) {
          expectedThreadId = original.threadId ?? null;
          if (input.quoteOriginal === true) {
            quote = await buildQuote(client, original, input.quoteLocale ?? 'cs');
          }
        }
      } finally {
        lock.release();
      }
    }

    const drafts = await findFolder(client, 'drafts');
    // Signature first, then the quote: the signature ends what is being
    // written, and under the history it would sit at the bottom of the thread.
    // Same as when sending: a draft written as plain text still gets its HTML
    // half, so what the user sees in Gmail is what goes out.
    const htmlBody = input.htmlBody ?? plainBodyToHtml(input.body);
    const signed = appendSignature(input.body, htmlBody, signature);
    const quoted = appendQuote(signed.body, signed.htmlBody, forwarded?.block ?? quote);
    const attachments = [...(input.attachments ?? []), ...(forwarded?.attachments ?? [])];
    const composed = await compose({
      ...input,
      subject: input.subject ?? forwarded?.subject ?? '',
      attachments,
      body: quoted.body,
      htmlBody: quoted.htmlBody,
      from,
      inReplyTo,
      references,
    });

    // The same limit as sending. A draft too large to go out is worse than a
    // refusal, because it looks finished and fails only when the user sends it.
    assertMessageFits(composed.raw.length, attachments.length);

    // \Seen keeps it from showing up as unread mail the user has not looked at -
    // they have not, but it is their own draft. Without it Gmail shows the
    // whole conversation the draft sits in as unread. See ./append.ts for why
    // the flag needs more than being passed to APPEND.
    //
    // \Draft is deliberately NOT set, which goes against the obvious reading of
    // IMAP. Gmail does not set it on its own drafts either: a draft written in
    // the web interface arrives in this folder carrying \Seen and nothing else,
    // and being in Drafts is what makes it a draft. A message that does carry
    // the flag is treated as foreign, and the web interface then folds its whole
    // body under the "show trimmed content" button, as if it were quoted history
    // - the draft looks empty and the user has to click to find their own text.
    //
    // Checked on a real mailbox on 16 September 2026, both ways round. This is
    // safe to do here because the server speaks to Gmail and nothing else; a
    // client that needs the flag to recognise a draft would be a reason to
    // revisit it.
    const appended = await appendAsRead(client, drafts.path, composed.raw);
    if (appended === false) {
      throw new ToolError(
        'upstream_error',
        `Gmail refused to store the draft in "${drafts.path}" for mailbox "${account.name}".`,
      );
    }

    let threadId: string | null = null;
    if (appended.uid !== null) {
      const lock = await client.getMailboxLock(drafts.path, { readOnly: true });
      try {
        const stored = await client.fetchOne(String(appended.uid), { uid: true, threadId: true }, { uid: true });
        threadId = stored === false ? null : stored.threadId ?? null;
      } finally {
        lock.release();
      }
    }

    const joinedThread = expectedThreadId === null ? null : threadId !== null && threadId === expectedThreadId;

    return {
      account: account.name,
      folder: drafts.path,
      message_id: composed.messageId,
      uid: appended.uid,
      from,
      to: input.to,
      thread_id: threadId,
      joined_thread: joinedThread,
      attachments: attachments.map((file) => file.filename),
      signature: signature?.name ?? null,
      quoted: quote !== null,
      forwarded: forwarded !== null,
      replaced: null as boolean | null,
      // The quote is only worth a word when there was something to quote:
      // a message that answers nothing has no history missing from it.
      warning: warningFor(
        joinedThread,
        appended,
        input.quoteOriginal === true && input.inReplyTo !== undefined,
        quote !== null,
      ),
    };
  });

  if (input.replaces === undefined) {
    return saved;
  }

  const lostThread =
    replacedThreaded && inReplyTo === null
      ? 'The draft it replaces was a reply or a forward, and this one is neither, so it is no longer in that ' +
        'thread. If it should be, save it again with the same in_reply_to or forward_of and replaces set to this draft.'
      : null;
  const withNote = (warning: string | null, note: string | null): string | null =>
    note === null ? warning : warning === null ? note : `${warning} ${note}`;

  // Only after the new draft is safely stored, so a failure leaves two drafts
  // rather than none. Trash, not deletion: the old text stays recoverable.
  try {
    await trashMessage(account, input.replaces);
    return { ...saved, replaced: true, warning: withNote(saved.warning, lostThread) };
  } catch (error) {
    const note =
      `The new draft is saved, but the old one <${normaliseMessageId(input.replaces)}> is still in Drafts: ` +
      `${error instanceof Error ? error.message : String(error)} Move it to Trash with mg_trash_message ` +
      'so the user does not send the wrong one.';
    return { ...saved, replaced: false, warning: withNote(withNote(saved.warning, lostThread), note) };
  }
}

/** How many drafts come back by default, and the most that can be asked for. */
const DEFAULT_DRAFT_RESULTS = 25;
const HIGHEST_DRAFT_RESULTS = 100;

export interface DraftSummary extends MessageSummary {
  /** Message-ID of the message this draft answers, or null when it is not a reply. */
  in_reply_to: string | null;
  /**
   * For a reply: whether the draft is in the thread it answers. False means it
   * would go out as a separate message. Null when the draft is not a reply, or
   * when the message it answers is no longer in the mailbox to compare against.
   */
  joined_thread: boolean | null;
  /** Set when something about this draft is worth knowing. Null when there is nothing to say. */
  warning: string | null;
}

export interface DraftList {
  account: string;
  /** The drafts folder as this mailbox names it; Gmail localises the name. */
  folder: string;
  /** Drafts in the folder. `drafts` holds the newest `max_results` of them. */
  total_drafts: number;
  drafts: DraftSummary[];
}

/** List the drafts of one mailbox, newest first. */
export async function listDrafts(account: Account, maxResults = DEFAULT_DRAFT_RESULTS): Promise<DraftList> {
  const limit = Math.min(Math.max(Math.trunc(maxResults), 1), HIGHEST_DRAFT_RESULTS);

  return withClient(account, async (client) => {
    const drafts = await findFolder(client, 'drafts');

    let stored: FetchMessageObject[] = [];
    const draftsLock = await client.getMailboxLock(drafts.path, { readOnly: true });
    try {
      // An empty folder is left alone. A UID range against one is a fetch for
      // messages that do not exist, which servers answer to in their own ways.
      const count = client.mailbox === false ? 0 : client.mailbox.exists;
      if (count > 0) {
        stored = await client.fetchAll(
          '1:*',
          { uid: true, threadId: true, internalDate: true, envelope: true, labels: true, flags: true, size: true },
          { uid: true },
        );
      }
    } finally {
      draftsLock.release();
    }

    const newestFirst = [...stored].sort((left, right) => toMillis(right.internalDate) - toMillis(left.internalDate));
    const page = newestFirst.slice(0, limit);

    // The thread each answered message belongs to, looked up under a single
    // open of all-mail rather than one open per draft. A parent missing from
    // the map is one that is no longer in the mailbox.
    const parentThreads = new Map<string, string | null>();
    const parentIds = [...new Set(page.map(answeredMessageId).filter((id): id is string => id !== null))];
    if (parentIds.length > 0) {
      const allMail = await findFolder(client, 'all');
      const allMailLock = await client.getMailboxLock(allMail.path, { readOnly: true });
      try {
        for (const parentId of parentIds) {
          parentThreads.set(parentId, await threadIdOf(client, parentId));
        }
      } finally {
        allMailLock.release();
      }
    }

    return {
      account: account.name,
      folder: drafts.path,
      total_drafts: stored.length,
      drafts: page.map((message) => toDraftSummary(account, message, parentThreads)),
    };
  });
}

/** The Message-ID a draft answers, from the envelope, or null when it answers nothing. */
function answeredMessageId(message: FetchMessageObject): string | null {
  const raw = message.envelope?.inReplyTo;
  if (raw === undefined) {
    return null;
  }
  const bare = normaliseMessageId(raw);
  return bare === '' ? null : bare;
}

function toDraftSummary(
  account: Account,
  message: FetchMessageObject,
  parentThreads: Map<string, string | null>,
): DraftSummary {
  const summary = toMessageSummary(account, message);
  const inReplyTo = answeredMessageId(message);
  const parentThread = inReplyTo === null ? null : parentThreads.get(inReplyTo) ?? null;
  const joinedThread =
    inReplyTo === null || parentThread === null || summary.thread_id === null
      ? null
      : summary.thread_id === parentThread;

  return {
    ...summary,
    in_reply_to: inReplyTo,
    joined_thread: joinedThread,
    warning: listedDraftWarning(inReplyTo, parentThread, joinedThread),
  };
}

function listedDraftWarning(
  inReplyTo: string | null,
  parentThread: string | null,
  joinedThread: boolean | null,
): string | null {
  if (joinedThread === false) {
    return (
      'This draft answers a message but is not in its thread, so sending it would start a separate conversation ' +
      'rather than continue that one.'
    );
  }
  if (inReplyTo !== null && parentThread === null) {
    return (
      `The message this draft answers, <${inReplyTo}>, is no longer in this mailbox, so whether the draft is ` +
      'still in its thread could not be checked.'
    );
  }
  return null;
}

/** The thread of a message in the folder currently open, or null when it is not there. */
async function threadIdOf(client: ImapFlow, messageId: string): Promise<string | null> {
  const uids = await searchByMessageId(client, messageId);
  if (uids.length === 0) {
    return null;
  }
  const found = await client.fetchOne(String(Math.max(...uids)), { uid: true, threadId: true }, { uid: true });
  return found === false ? null : found.threadId ?? null;
}

function toMillis(value: Date | string | undefined): number {
  if (value === undefined) {
    return 0;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function warningFor(
  joinedThread: boolean | null,
  stored: StoredAsRead,
  quoteAsked: boolean,
  quoteMade: boolean,
): string | null {
  if (joinedThread === false) {
    return (
      'The draft was saved but did not join the thread it replies to, so it would go out as a separate message. ' +
      'Check the In-Reply-To value against the Message-ID of the message being answered.'
    );
  }
  if (quoteAsked && !quoteMade) {
    return (
      'The draft carries no quoted history: the message it answers has no readable body to quote. The reply will ' +
      'reach the recipient as the new text alone, which matters most when it is being passed on to somebody who ' +
      'has not seen the thread.'
    );
  }
  if (stored.uid === null) {
    return 'The server did not report a UID for the draft, so it could not be read back after being stored.';
  }
  if (stored.seen === false) {
    return (
      'The draft was saved but Gmail kept it unread, so the conversation it sits in shows as unread. ' +
      'Mark it read with mg_set_flags (seen: true).'
    );
  }
  return null;
}
