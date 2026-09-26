// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karel Derfl

/**
 * Turning an IMAP fetch response into the shape the tools return.
 *
 * Two pairs of fields here exist because the members of each pair disagree,
 * and picking one would hide the disagreement:
 *
 * - `message_id` and `uid`. A UID is valid only inside the folder it was read
 *   from, so archiving a message changes it. Anything a caller stores has to
 *   be the Message-ID from the header.
 * - `received_at` and `date_header`. Filtering goes by delivery time; the
 *   header is what the sender claimed. They differ on forwarded and on
 *   scheduled messages.
 *
 * `processed` is spelled out rather than left inside the raw label list,
 * because whether a message has already been through a pass is the first thing
 * the assistant needs from a thread and should not have to be derived.
 *
 * It is deliberately not the same as `seen`. The \Seen flag is set by a person
 * opening the message in a mail client, and since this server opens mailboxes
 * read-only, the assistant's own reading never sets it. `seen` therefore says
 * nothing about what the assistant has done, and on a shared mailbox it says
 * little about anything: unread there does not mean unhandled, because a
 * colleague may have dealt with it without marking it.
 */

import type { FetchMessageObject, MessageAddressObject } from 'imapflow';

import type { Account } from '../config.js';

export interface AddressJson {
  name: string | null;
  address: string | null;
}

export type MessageState = 'received' | 'sent' | 'draft' | 'scheduled';

export interface MessageSummary {
  /** Which mailbox this came from. Present on every object, so a cross-mailbox answer keeps its context. */
  account: string;
  /** Stable across folders and mailboxes. This is the reference a caller should keep. */
  message_id: string | null;
  /** Valid only within this folder and this operation. Not a reference to keep. */
  uid: number;
  thread_id: string | null;
  subject: string | null;
  from: AddressJson | null;
  to: AddressJson[];
  cc: AddressJson[];
  /** Delivery time, IMAP INTERNALDATE. Time filtering goes by this one. */
  received_at: string | null;
  /** The Date: header. Differs from received_at on forwarded and scheduled messages. */
  date_header: string | null;
  state: MessageState;
  /**
   * Whether this message has already been through a pass, by the label
   * configured for the mailbox. It decides whether the message belongs in the
   * next pass and nothing more: noise carries it too, and so does a message
   * still waiting for an answer. What still has to happen is carried by a
   * classification on the thread.
   */
  processed: boolean;
  /**
   * The IMAP \Seen flag: a person opened the message in a mail client. NOT a
   * record of what the assistant has read - this server opens mailboxes
   * read-only, so reading a message here never sets it. Use `processed`.
   */
  seen: boolean;
  /** Whether the message is in the inbox or archived. Told by the label, not by the folder. */
  in_inbox: boolean;
  labels: string[];
  flags: string[];
  size_bytes: number | null;
}

/**
 * The newest matching message of a thread, as a search returns it.
 *
 * Deliberately narrower than MessageSummary. A search over forty threads that
 * spelled out every field of every newest message came to some seventy
 * thousand characters and had to be read from a file instead of from the
 * answer - at which point the tool that exists to find things across mailboxes
 * cannot be used for what it is for.
 *
 * Nothing is lost by leaving fields out, because searching is the first of two
 * stages: mg_get_thread gives the whole thread and mg_get_message the body,
 * both of them fully. What stays here is what a result list is actually read
 * for - who wrote, when it arrived, whether it is still in the inbox, whether
 * it has been delivered at all, and the one identifier worth keeping.
 *
 * Three absences are on purpose. `account` is not repeated because the thread
 * carries it one level up, in the same object. `processed` is not here because
 * `unprocessed_matches` answers the same question better: it counts every
 * matching message of the thread, not only the newest one. `uid`, `labels`,
 * `flags`, `size_bytes`, `date_header`, `to` and `cc` are gone because they
 * are read in the rare case, and the rare case has mg_get_thread.
 */
export interface MatchSummary {
  /**
   * Stable across folders and mailboxes. Kept here, thin as this object is,
   * because it is the one way to read a body without opening the thread first.
   */
  message_id: string | null;
  from: AddressJson | null;
  /** Delivery time, IMAP INTERNALDATE. Time filtering goes by this one. */
  received_at: string | null;
  /**
   * Kept because a search can return mail that never went out. A scheduled
   * message is not delivered yet, so without this it reads as one that has
   * already been sent - and answering it would be answering something nobody
   * has received.
   */
  state: MessageState;
  /** Whether the message is in the inbox or archived. Told by the label, not by the folder. */
  in_inbox: boolean;
}

/** Tolerance for clock skew before a date counts as being in the future. */
const FUTURE_SLACK_MS = 60_000;

/** A usable Date, whichever of the two forms the mailbox reported. */
function toDate(value: string | Date | undefined | null): Date | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function toMessageSummary(account: Account, message: FetchMessageObject, now = new Date()): MessageSummary {
  const labels = message.labels ?? new Set<string>();
  const flags = message.flags ?? new Set<string>();
  const envelope = message.envelope;

  return {
    account: account.name,
    message_id: envelope?.messageId ?? null,
    uid: message.uid,
    thread_id: message.threadId ?? null,
    subject: envelope?.subject ?? null,
    from: toAddress(envelope?.from?.[0]),
    to: (envelope?.to ?? []).map(toAddress).filter((entry): entry is AddressJson => entry !== null),
    cc: (envelope?.cc ?? []).map(toAddress).filter((entry): entry is AddressJson => entry !== null),
    received_at: toIso(message.internalDate),
    date_header: toIso(envelope?.date),
    state: deriveState(labels, flags, toDate(envelope?.date), toDate(message.internalDate), isFromSelf(envelope, account), now),
    processed: account.processedLabel !== null && carriesName(labels, account.processedLabel),
    seen: carriesName(flags, 'seen'),
    in_inbox: carriesName(labels, 'inbox'),
    labels: [...labels].sort(),
    flags: [...flags].sort(),
    size_bytes: message.size ?? null,
  };
}

/** The same message, narrowed to what a search result needs. See MatchSummary. */
export function toMatchSummary(account: Account, message: FetchMessageObject, now = new Date()): MatchSummary {
  const labels = message.labels ?? new Set<string>();
  const flags = message.flags ?? new Set<string>();
  const envelope = message.envelope;

  return {
    message_id: envelope?.messageId ?? null,
    from: toAddress(envelope?.from?.[0]),
    received_at: toIso(message.internalDate),
    state: deriveState(labels, flags, toDate(envelope?.date), toDate(message.internalDate), isFromSelf(envelope, account), now),
    in_inbox: carriesName(labels, 'inbox'),
  };
}

/**
 * Is the message from the mailbox itself?
 *
 * Only the user's own mail can be waiting on a timer, so this is what keeps a
 * stranger's message from being read as scheduled - and a message read as
 * scheduled drops out of the pass entirely.
 */
function isFromSelf(envelope: FetchMessageObject['envelope'], account: Account): boolean {
  const from = envelope?.from?.[0]?.address;
  return from !== undefined && from.toLowerCase() === account.address.toLowerCase();
}

/** The subject of a message, for the thread-level field that carries it. */
export function subjectOf(message: FetchMessageObject): string | null {
  return message.envelope?.subject ?? null;
}

function toAddress(address: MessageAddressObject | undefined): AddressJson | null {
  if (address === undefined) {
    return null;
  }
  // A missing value is null rather than an empty string: an empty string says
  // "this is empty", null says "this is not known".
  return { name: address.name ?? null, address: address.address ?? null };
}

function toIso(value: Date | string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function deriveState(
  labels: Set<string>,
  flags: Set<string>,
  dateHeader: Date | undefined,
  internalDate: Date | undefined,
  fromSelf: boolean,
  now: Date,
): MessageState {
  const isDraft = carriesName(labels, 'draft') || carriesName(flags, 'draft');
  const isSent = carriesName(labels, 'sent');

  // A message the mailbox has not received yet is one waiting on a timer.
  //
  // This goes by INTERNALDATE rather than the Date: header, and that is the
  // whole point of it. The header is written by the sender and a wrong clock
  // is common; INTERNALDATE is set by Gmail when it files the message, so a
  // stranger cannot put anything in it. Delivery in the future does not
  // otherwise happen.
  //
  // Confirmed against a real scheduled message on 16 September 2026: Gmail
  // gives one no labels at all and only the \Seen flag, so the label test
  // below cannot see it. What it does have is an INTERNALDATE at the time it
  // is due to go out.
  //
  // `fromSelf` is what keeps this safe. Reading a message as scheduled takes
  // it out of the pass - it is not work, it does not hold the boundary, and
  // nothing shows it again - so the one case that must never be misread is
  // somebody else's mail. Only the user's own can be on a timer.
  if (
    fromSelf &&
    internalDate !== undefined &&
    internalDate.getTime() > now.getTime() + FUTURE_SLACK_MS
  ) {
    return 'scheduled';
  }

  // Gmail keeps a message waiting on a timer with its Date: header set to the
  // time it is due to go out, so in a listing it reads as a message from the
  // future that has in fact not been sent. Without a separate state there is
  // no way to tell it from one that has.
  //
  // **Only the user's own mail can be waiting on a timer**, which is why the
  // labels are consulted before the header and not after. An incoming message
  // with a Date in the future has a sender whose clock or time zone is wrong,
  // and it arrives often enough to matter. Calling that one scheduled would
  // take it out of the pass altogether: it would not count as work, would not
  // hold the boundary back, and would never be seen again - the exact silent
  // loss this server exists to prevent. A header is the sender's claim; a
  // label is what the mailbox knows.
  //
  // Not yet confirmed against a real scheduled message - the test on a real
  // mailbox has to check which labels Gmail puts on one. If it turns out to
  // carry neither, a scheduled message reads as received and is treated as
  // work, which errs towards showing too much rather than hiding.
  if ((isDraft || isSent) && dateHeader !== undefined && dateHeader.getTime() > now.getTime() + FUTURE_SLACK_MS) {
    return 'scheduled';
  }
  if (isDraft) {
    return 'draft';
  }
  if (isSent) {
    return 'sent';
  }
  return 'received';
}

/**
 * Match a flag or label by name.
 *
 * Gmail reports its own labels and IMAP its own flags with a leading backslash
 * ("\\Inbox", "\\Seen") while user labels have none, and the escaping has
 * varied between servers. Comparison strips the backslashes and ignores case,
 * so a change in escaping cannot quietly turn every message into an unread,
 * archived one.
 */
export function carriesName(values: Set<string>, name: string): boolean {
  const wanted = name.replace(/^\\+/, '').toLowerCase();
  for (const value of values) {
    if (value.replace(/^\\+/, '').toLowerCase() === wanted) {
      return true;
    }
  }
  return false;
}
