// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karel Derfl

/**
 * One pass over new mail.
 *
 * **The query is built here and takes no text from the caller**, and that is
 * the whole point of this module existing beside ./search.ts. The pass query
 * has exactly two conditions - not carrying the processed label, and delivered
 * since the caller's boundary - and nothing may be added to it. Gmail
 * evaluates conditions per message rather than per thread, so one extra
 * condition such as `from:` drops a thread whose unprocessed message happens to
 * be from somebody else, and the answer comes back looking like a clean empty
 * result. A rule whose breach is silent cannot rest on the caller reading a
 * description, so there is no parameter here through which a condition could
 * arrive.
 *
 * **The time boundary goes by delivery, not by the Date header.** It is an
 * IMAP SINCE, which is defined on INTERNALDATE, rather than Gmail's own
 * `after:`. The two disagree on forwarded mail: a message forwarded today but
 * written last month carries last month's Date, and a boundary that went by
 * the header would never show it again. SINCE compares whole days and ignores
 * the time, so the boundary's own day is walked again on every pass - which
 * costs nothing, because everything already done carries the label.
 *
 * **Drafts and scheduled messages are not work.** They are the user's own
 * writing, they sit in all-mail without the processed label, and a scheduled
 * message keeps matching until it goes out. Labelling them would not help:
 * editing a draft replaces the message, so the label does not survive. They are
 * therefore taken out after the search - never as a third condition, which
 * could hide a thread - and reported separately. A scheduled message still
 * shows up beside a thread that *is* work, because that is when knowing about
 * it matters: it stops a second answer being written to something already
 * waiting on a timer.
 */

import type { FetchMessageObject, ImapFlow } from 'imapflow';

import type { Account } from '../config.js';
import { ToolError } from '../errors.js';
import { toMessageSummary, type AddressJson, type MessageState } from './message.js';
import {
  clampMaxResults,
  parsePageToken,
  toAccountFailure,
  toMillis,
  MAX_MATCHES,
  type AccountFailure,
} from './search.js';
import { withAllMail } from './session.js';

/** A message that has not been through a pass. Lighter than a full summary on purpose. */
export interface PassMessage {
  /** Which mailbox this came from, so a cross-mailbox answer keeps its context. */
  account: string;
  /** The stable reference. This is what mg_label_message takes. */
  message_id: string | null;
  from: AddressJson | null;
  /**
   * Recipients, kept apart from cc on purpose: being only in copy usually means
   * the thing belongs to somebody else, and merging the two loses that.
   */
  to: AddressJson[];
  cc: AddressJson[];
  /** Delivery time. The boundary goes by this. */
  received_at: string | null;
  /** `received` for incoming mail, `sent` for the user's own reply already gone out. */
  state: MessageState;
  /** False for archived mail, which is usually mail already dealt with. */
  in_inbox: boolean;
}

/** The user's own unsent writing in a thread: a draft, or a message on a timer. */
export interface PendingOutgoing {
  message_id: string | null;
  to: AddressJson[];
  subject: string | null;
  state: 'draft' | 'scheduled';
  /** When a scheduled message is due to go out, from its Date header. Null for a draft. */
  goes_out_at: string | null;
}

export interface PassThread {
  account: string;
  thread_id: string;
  subject: string | null;
  /**
   * How many messages the whole thread holds, so a view of part of it is
   * visibly a part. When this is larger than `unprocessed`, read the thread
   * with mg_get_thread before answering.
   *
   * Null when the mailbox would not say. It is deliberately not filled in with
   * the number of messages already in hand: that would read as "this is the
   * whole thread" and the rest of the conversation would go unread.
   */
  message_count: number | null;
  last_received_at: string | null;
  /**
   * The classification the thread carries now, so a caller changing it knows
   * what it is changing from. A thread carries one, so this is normally empty
   * or a single entry; more than one means it was labelled outside these tools,
   * and the next mg_label_thread will tidy it up.
   */
  classification: string[];
  /**
   * Labels on the thread that this server does not manage: whatever the people
   * using the mailbox put there themselves. System labels are left out, and so
   * are the processed label and the configured classifications, which have
   * their own fields.
   *
   * This is what makes a shared mailbox workable. A team marks a conversation
   * with whoever is handling it, and without seeing that mark the only way to
   * tell whether a thread is yours is to read it - which costs a round trip and
   * a body for every thread the team owns. The labels are free: Gmail puts a
   * thread label on every message of the thread, so they are already in the
   * fetch the classification is read from.
   *
   * It says nothing about who should act. Deciding that a thread belongs to the
   * user is the caller's judgement, and it stays the caller's, because the
   * meaning of a team's labels lives outside this server.
   */
  user_labels: string[];
  /**
   * Whose thread this is, on a mailbox that names its assignment labels:
   *
   * - `mine` - it carries the label configured as the user's own
   * - `other` - it carries one of the team's labels, but not that one
   * - `none` - it carries none of them, so nobody has claimed it
   *
   * Null on a mailbox that does not work this way, and that is not the same as
   * `none`: one says nobody has taken the thread, the other says the question
   * is not being asked here.
   *
   * Only the configured labels are weighed. An archive label, a folder, a
   * project - anything outside the list - leaves a thread `none` rather than
   * making it somebody else's, which is the mistake this field exists to
   * prevent.
   */
  assigned: 'mine' | 'other' | 'none' | null;
  /** The messages that have not been through a pass. Never empty - that is what makes this thread work. */
  unprocessed: PassMessage[];
  /** Drafts and scheduled messages in this thread, so no second answer gets written. */
  pending_outgoing: PendingOutgoing[];
}

export interface PassResult {
  /** The moment the mailbox was asked. Move the boundary to this, never to "now". */
  searched_at: string;
  /** The boundary that was used, echoed back. */
  since: string;
  threads: PassThread[];
  total_threads: number;
  next_page_token: string | null;
  /**
   * Threads the search returned whose messages all turned out to carry the
   * label already. Gmail updates its search index some time after a label is
   * written, so a pass keeps matching mail that was dealt with a moment ago.
   * They are counted rather than returned, and reading them again would be
   * work for nothing.
   */
  stale_threads: number;
  /** Drafts in the window. Not work, and they never hold the boundary back. */
  drafts_in_window: number;
  /** Scheduled messages in the window. Not work either, for the same reason. */
  scheduled_in_window: number;
  /**
   * Messages in the window that fall outside the mailbox's work scope - on an
   * inbox-scoped mailbox, everything not in the inbox. Always zero on a mailbox
   * scoped to everything. They never hold the boundary back; a thread that is
   * work for another reason lists them anyway.
   */
  outside_scope_in_window: number;
  /**
   * Delivery time of the oldest message in the window that has not been through
   * a pass, across every page. Null when there is none - and when it stops
   * moving between passes, something in the window cannot be labelled.
   */
  oldest_unprocessed_at: string | null;
  /**
   * True when nothing in the window is unprocessed, which is the one condition
   * under which the boundary may be moved to `searched_at`.
   */
  window_clear: boolean;
  /** Mailboxes that answered. */
  searched: string[];
  /** Mailboxes that did not, named rather than silently missing from the results. */
  failures: AccountFailure[];
}

/** Run a pass over one mailbox. */
export async function runPass(
  account: Account,
  since: Date,
  maxThreads: number,
  pageToken?: string,
): Promise<PassResult> {
  const limit = clampMaxResults(maxThreads);
  const offset = parsePageToken(pageToken);
  const one = await passOverMailbox(account, since, limit, offset);
  return {
    ...one,
    searched: [account.name],
    failures: [],
  };
}

/**
 * Run a pass over every mailbox and merge the answers, newest activity first.
 *
 * A mailbox that cannot answer is named in `failures` while the rest of the
 * answer stands, and its counts are simply missing - an empty answer in its
 * place would read as "there is nothing new", which is the wrong conclusion.
 */
export async function runPassEverywhere(
  accounts: Account[],
  since: Date,
  maxThreads: number,
  pageToken?: string,
): Promise<PassResult> {
  const limit = clampMaxResults(maxThreads);
  const offset = parsePageToken(pageToken);

  const settled = await Promise.allSettled(
    accounts.map((account) => passOverMailbox(account, since, offset + limit, 0)),
  );

  const merged: PassThread[] = [];
  const searched: string[] = [];
  const failures: AccountFailure[] = [];
  let total = 0;
  let stale = 0;
  let drafts = 0;
  let scheduled = 0;
  let outside = 0;
  let oldest: number | null = null;
  let clear = true;
  // The earliest moment any mailbox was asked. Moving the boundary to the
  // latest one would step over mail that reached a slower mailbox in between.
  let askedAt: number | null = null;

  for (const [index, result] of settled.entries()) {
    const account = accounts[index];
    if (account === undefined) {
      continue;
    }
    if (result.status !== 'fulfilled') {
      failures.push(toAccountFailure(account, result.reason));
      // A mailbox that did not answer says nothing about its window, so the
      // boundary must not move on its behalf either.
      clear = false;
      continue;
    }
    const value = result.value;
    searched.push(account.name);
    merged.push(...value.threads);
    total += value.total_threads;
    stale += value.stale_threads;
    drafts += value.drafts_in_window;
    scheduled += value.scheduled_in_window;
    outside += value.outside_scope_in_window;
    clear = clear && value.window_clear;
    const asked = Date.parse(value.searched_at);
    if (!Number.isNaN(asked) && (askedAt === null || asked < askedAt)) {
      askedAt = asked;
    }
    const at = value.oldest_unprocessed_at === null ? null : Date.parse(value.oldest_unprocessed_at);
    if (at !== null && !Number.isNaN(at) && (oldest === null || at < oldest)) {
      oldest = at;
    }
  }

  merged.sort((left, right) => lastActivity(right) - lastActivity(left));
  const page = merged.slice(offset, offset + limit);
  const consumed = offset + page.length;

  return {
    searched_at: new Date(askedAt ?? Date.now()).toISOString(),
    since: since.toISOString(),
    threads: page,
    total_threads: total,
    next_page_token: consumed < total ? String(consumed) : null,
    stale_threads: stale,
    drafts_in_window: drafts,
    scheduled_in_window: scheduled,
    outside_scope_in_window: outside,
    oldest_unprocessed_at: oldest === null ? null : new Date(oldest).toISOString(),
    window_clear: clear && total === 0,
    searched,
    failures,
  };
}

type MailboxPass = Omit<PassResult, 'searched' | 'failures'>;

interface ThreadWork {
  threadId: string;
  work: FetchMessageObject[];
  outgoing: FetchMessageObject[];
  /**
   * Messages that fall outside the mailbox's work scope - on an inbox-scoped
   * mailbox, everything that is not in the inbox. Shown beside a thread that is
   * work, so an answer already given is visible without opening the thread, but
   * never enough on their own to make a thread work.
   */
  outside: FetchMessageObject[];
  /** Matched messages that turned out to carry the label already. Counted, never returned. */
  stale: number;
  newestAt: number;
}

/**
 * What a pass finds in its window before paging: the threads with work, and
 * what was counted beside them. Shared by the pass and the waiting mode
 * (--wait, ../watch.ts), so that the watcher asks exactly what a pass asks -
 * if the two drifted apart, the watcher would report nothing while a pass
 * would find mail, and that silence would look like an empty mailbox.
 */
interface WindowScan {
  searchedAt: Date;
  /** Threads with work, newest activity first. */
  work: ThreadWork[];
  stale: number;
  drafts: number;
  scheduled: number;
  outside: number;
  oldest: number | null;
}

async function scanWindow(client: ImapFlow, account: Account, since: Date): Promise<WindowScan> {
  // Taken before the search, never after the work: mail that arrives while
  // the pass runs has to stay on the near side of the boundary.
  const searchedAt = new Date();

  // Two conditions, built from parts rather than from a string. There is no
  // text here to add a third one to.
  // Two conditions where the mailbox is labelled, one where it is not: a
  // mailbox with no processed label has nothing to exclude by, so the window
  // is the whole condition.
  const uids = await client.search(
    account.processedLabel === null
      ? { since }
      : { labels: { not: [account.processedLabel] }, since },
    { uid: true },
  );

  if (uids === false || uids.length === 0) {
    return { searchedAt, work: [], stale: 0, drafts: 0, scheduled: 0, outside: 0, oldest: null };
  }
  if (uids.length > MAX_MATCHES) {
    throw new ToolError(
      'query_too_broad',
      `The window since ${since.toISOString().slice(0, 10)} holds ${uids.length} messages without the label ` +
        `${account.processedLabel === null ? 'in' : `"${account.processedLabel}" in`} mailbox "${account.name}", more than the ${MAX_MATCHES} this server ` +
        'will group into threads at once. This is normally a first pass or a long catch-up. Do it in ' +
        'chunks: give a later boundary, clear that window until window_clear comes back true, then come ' +
        'back with an earlier boundary for the chunk before it. Be careful with that - simply leaving the ' +
        'boundary at the later date is how mail is lost, because everything before it is then in no ' +
        'window at all and no pass will show it again. If the mailbox is older than this server, its ' +
        'older mail carries no label and never will: the honest first boundary is the day it was set up.',
    );
  }

  // Everything the classification needs, in one fetch. The labels decide what
  // is genuinely unprocessed - the search index says it is, but says so from
  // a moment ago - and the envelope decides what is scheduled.
  const fetched = await client.fetchAll(
    uids,
    { uid: true, threadId: true, internalDate: true, envelope: true, labels: true, flags: true },
    { uid: true },
  );

  const groups = new Map<string, ThreadWork>();
  let drafts = 0;
  let scheduled = 0;
  let outside = 0;
  let oldest: number | null = null;

  for (const message of fetched) {
    if (message.threadId === undefined) {
      throw new ToolError(
        'provider_unsupported',
        `Mailbox "${account.name}" returned a message without a thread id, so it does not support the Gmail ` +
          'X-GM-THRID extension. Threads cannot be built without it.',
      );
    }
    const summary = toMessageSummary(account, message, searchedAt);

    const group = groups.get(message.threadId) ?? {
      threadId: message.threadId,
      work: [],
      outgoing: [],
      outside: [],
      stale: 0,
      newestAt: 0,
    };
    groups.set(message.threadId, group);

    // The index said this had no label and the message says it has: dealt
    // with a moment ago, and reading it again would be work for nothing.
    // Counted on the thread, because a thread is what the caller skips.
    if (summary.processed) {
      group.stale += 1;
      continue;
    }

    if (summary.state === 'draft' || summary.state === 'scheduled') {
      if (summary.state === 'draft') {
        drafts += 1;
      } else {
        scheduled += 1;
      }
      group.outgoing.push(message);
      continue;
    }

    // On a mailbox scoped to its inbox, anything else is somebody's filing or
    // somebody's answer: archived mail was put away on purpose, and the sent
    // folder of a shared mailbox holds other people's replies. Taken out here
    // rather than in the query, for the reason the module header gives: a
    // third condition drops the whole thread and the answer comes back
    // looking clean.
    if (account.workScope === 'inbox' && !summary.in_inbox) {
      outside += 1;
      group.outside.push(message);
      continue;
    }

    // On a mailbox where something else does the processing, a message
    // somebody has already opened is a message dealt with. Same treatment as
    // everything else out of scope: counted, never work on its own, never
    // holding the boundary.
    if (account.unreadOnly && summary.seen) {
      outside += 1;
      group.outside.push(message);
      continue;
    }

    group.work.push(message);
    const at = toMillis(message.internalDate);
    if (at > group.newestAt) {
      group.newestAt = at;
    }
    if (oldest === null || at < oldest) {
      oldest = at;
    }
  }

  // A thread whose only unprocessed messages are the user's own unsent
  // writing is not work. Returning it would put it in front of the caller on
  // every pass for as long as the draft sits there.
  const everything = [...groups.values()];
  const work = everything
    .filter((group) => group.work.length > 0)
    .sort((left, right) => right.newestAt - left.newestAt);

  // A thread is stale when everything the search matched in it turned out to
  // carry the label already. One holding a draft is left out of this count:
  // it is not returned either, but drafts_in_window is what says so.
  const stale = everything.filter(
    (group) =>
      group.work.length === 0 &&
      group.outgoing.length === 0 &&
      group.outside.length === 0 &&
      group.stale > 0,
  ).length;

  return { searchedAt, work, stale, drafts, scheduled, outside, oldest };
}

async function passOverMailbox(
  account: Account,
  since: Date,
  limit: number,
  offset: number,
): Promise<MailboxPass> {
  return withAllMail(account, async ({ client }) => {
    const scan = await scanWindow(client, account, since);
    const { searchedAt, work, stale, drafts, scheduled, outside, oldest } = scan;
    const page = work.slice(offset, offset + limit);
    const facts = await threadFacts(client, page);
    const threads = page.map((group) =>
      toPassThread(account, group, facts.get(group.threadId), searchedAt),
    );

    const consumed = offset + page.length;
    return {
      searched_at: searchedAt.toISOString(),
      since: since.toISOString(),
      threads,
      total_threads: work.length,
      next_page_token: consumed < work.length ? String(consumed) : null,
      stale_threads: stale,
      drafts_in_window: drafts,
      scheduled_in_window: scheduled,
      outside_scope_in_window: outside,
      oldest_unprocessed_at: oldest === null ? null : new Date(oldest).toISOString(),
      window_clear: work.length === 0,
    };
  });
}

/**
 * The messages a pass would show as work right now, as keys that stay the same
 * between checks (Message-ID, or the UID where a message has none). The
 * waiting mode compares them with what was already waiting when it started.
 */
export async function pendingWork(account: Account, since: Date): Promise<Set<string>> {
  return withAllMail(account, async ({ client }) => {
    const scan = await scanWindow(client, account, since);
    const keys = new Set<string>();
    for (const group of scan.work) {
      for (const message of group.work) {
        keys.add(message.envelope?.messageId ?? `uid:${message.uid}`);
      }
    }
    return keys;
  });
}

interface ThreadFacts {
  /** Null when the mailbox would not say, rather than a number that is not the whole count. */
  messageCount: number | null;
  /** From the oldest message of the thread, so it is the subject rather than "Re: Re: ...". */
  subject: string | null;
  /**
   * Every label carried by any message of the thread.
   *
   * Read from the whole thread rather than from the unprocessed messages,
   * because a label on a conversation does not reach all of its messages. Gmail
   * applies a thread label to the messages that exist when it is written, and to
   * incoming replies afterwards - but a message the user sends later is created
   * in Sent and carries none of it. A thread whose only unprocessed message is
   * the user's own reply would therefore look unclassified, which is exactly
   * the thread where knowing the classification matters most.
   */
  labels: string[];
}

/**
 * How long each thread on the page is, and what it is called.
 *
 * The search returned only the thread's unlabelled messages, which says nothing
 * about the size of the conversation they belong to. Asked for the whole page
 * at once rather than thread by thread: one search and one fetch instead of a
 * round trip per thread, on a connection that runs its commands one at a time
 * anyway.
 *
 * **It fetches an envelope for every message of every thread on the page**, and
 * only two things come out of them: how many there are, and the subject of the
 * oldest. None of it reaches the caller, so it costs traffic to Gmail rather
 * than anything the caller pays for - but a page of twenty-five long threads is
 * already hundreds of envelopes. If the page size is ever raised, split this in
 * two: fetch uid, threadId and internalDate for all of them, which is what the
 * counting needs, and then envelopes for only the oldest message of each
 * thread, which is the only place the subject comes from.
 */
async function threadFacts(client: ImapFlow, groups: ThreadWork[]): Promise<Map<string, ThreadFacts>> {
  const facts = new Map<string, ThreadFacts>();
  const unknown = { messageCount: null, subject: null, labels: [] };
  if (groups.length === 0) {
    return facts;
  }

  const first = groups[0];
  if (first === undefined) {
    return facts;
  }
  const query =
    groups.length === 1
      ? { threadId: first.threadId }
      : { or: groups.map((group) => ({ threadId: group.threadId })) };

  const uids = await client.search(query, { uid: true });
  if (uids === false || uids.length === 0) {
    for (const group of groups) {
      facts.set(group.threadId, unknown);
    }
    return facts;
  }

  const counts = new Map<string, number>();
  const oldest = new Map<string, { at: number; subject: string | null }>();
  const labels = new Map<string, Set<string>>();
  const fetched = await client.fetchAll(
    uids,
    { uid: true, threadId: true, internalDate: true, envelope: true, labels: true },
    { uid: true },
  );
  for (const message of fetched) {
    const threadId = message.threadId;
    if (threadId === undefined) {
      continue;
    }
    counts.set(threadId, (counts.get(threadId) ?? 0) + 1);
    const at = toMillis(message.internalDate);
    const current = oldest.get(threadId);
    if (current === undefined || at < current.at) {
      oldest.set(threadId, { at, subject: message.envelope?.subject ?? null });
    }
    let seen = labels.get(threadId);
    if (seen === undefined) {
      seen = new Set<string>();
      labels.set(threadId, seen);
    }
    for (const value of message.labels ?? []) {
      seen.add(value);
    }
  }

  for (const group of groups) {
    facts.set(group.threadId, {
      messageCount: counts.get(group.threadId) ?? null,
      subject: oldest.get(group.threadId)?.subject ?? null,
      labels: [...(labels.get(group.threadId) ?? [])],
    });
  }
  return facts;
}

function toPassThread(
  account: Account,
  group: ThreadWork,
  facts: ThreadFacts | undefined,
  now: Date,
): PassThread {
  // Messages outside the work scope ride along with the thread they belong to.
  // They did not bring the thread here and they never hold the boundary, but
  // seeing "this was archived" or "somebody has already answered" beside the
  // question is the whole reason to look at a thread at all.
  const unprocessed = [...group.work, ...group.outside]
    .map((message) => toPassMessage(account, message, now))
    .sort((left, right) => received(left) - received(right));

  const newest = group.work.reduce(
    (latest, message) => Math.max(latest, toMillis(message.internalDate)),
    0,
  );

  // The whole thread's labels when the mailbox gave them, otherwise the ones on
  // the messages in hand. The fallback is worse - a label written on the
  // conversation may not have reached the user's own later reply - but it is
  // better than reporting a thread as carrying nothing at all.
  const labels =
    facts !== undefined && facts.labels.length > 0
      ? facts.labels
      : [...group.work, ...group.outgoing].flatMap((message) => [...(message.labels ?? [])]);

  return {
    account: account.name,
    thread_id: group.threadId,
    subject: facts?.subject ?? group.work[0]?.envelope?.subject ?? null,
    message_count: facts?.messageCount ?? null,
    classification: classificationOf(account, labels),
    user_labels: userLabelsOf(account, labels),
    assigned: assignmentOf(account, labels),
    last_received_at: newest === 0 ? null : new Date(newest).toISOString(),
    unprocessed,
    pending_outgoing: group.outgoing.map((message) => toPendingOutgoing(account, message, now)),
  };
}

function toPassMessage(account: Account, message: FetchMessageObject, now: Date): PassMessage {
  const summary = toMessageSummary(account, message, now);
  return {
    account: summary.account,
    message_id: summary.message_id,
    from: summary.from,
    to: summary.to,
    cc: summary.cc,
    received_at: summary.received_at,
    state: summary.state,
    in_inbox: summary.in_inbox,
  };
}

function toPendingOutgoing(
  account: Account,
  message: FetchMessageObject,
  now: Date,
): PendingOutgoing {
  const summary = toMessageSummary(account, message, now);
  const scheduled = summary.state === 'scheduled';
  return {
    message_id: summary.message_id,
    to: summary.to,
    subject: summary.subject,
    state: scheduled ? 'scheduled' : 'draft',
    goes_out_at: scheduled ? summary.date_header : null,
  };
}

function empty(searchedAt: Date, since: Date): MailboxPass {
  return {
    searched_at: searchedAt.toISOString(),
    since: since.toISOString(),
    threads: [],
    total_threads: 0,
    next_page_token: null,
    stale_threads: 0,
    drafts_in_window: 0,
    scheduled_in_window: 0,
    outside_scope_in_window: 0,
    oldest_unprocessed_at: null,
    window_clear: true,
  };
}

/**
 * The configured classifications on a thread, picked out of the thread's
 * labels. Matched case-insensitively, because Gmail does not promise the case
 * it stores a label in, and reported under the configured spelling.
 */
function classificationOf(account: Account, labels: string[]): string[] {
  const configured = Object.keys(account.classificationLabels);
  if (configured.length === 0) {
    return [];
  }
  const present = new Set<string>();
  for (const value of labels) {
    const match = configured.find((candidate) => candidate.toLowerCase() === value.toLowerCase());
    if (match !== undefined) {
      present.add(match);
    }
  }
  return [...present].sort();
}

/**
 * The labels on a thread that belong to whoever uses the mailbox, taken from
 * the messages already fetched.
 *
 * Three kinds are left out. System labels - the ones IMAP spells with a
 * backslash, like \Inbox and \Sent - are not labels anybody put there, and
 * `in_inbox` and `state` already say what they say. The processed label and the
 * configured classifications are this server's own bookkeeping and have their
 * own fields; repeating them here would invite a caller to act on a label it
 * wrote itself a moment ago.
 *
 * What is left is genuinely somebody else's: a team's assignment labels, a
 * user's folders, whatever Gmail filters put there. Matched case-insensitively
 * against the configured names, the same way the classification is, because
 * Gmail does not promise the case it stores a label in.
 */
function userLabelsOf(account: Account, labels: string[]): string[] {
  const ours = new Set<string>(
    [...(account.processedLabel === null ? [] : [account.processedLabel]), ...Object.keys(account.classificationLabels)].map((name) =>
      name.toLowerCase(),
    ),
  );
  const present = new Map<string, string>();
  for (const value of labels) {
    // IMAP spells a system label with a leading backslash. Gmail's own
    // categories arrive that way too, so this drops \Inbox, \Sent, \Draft,
    // \Important, \Starred and the rest in one go.
    if (value.startsWith('\\')) {
      continue;
    }
    const key = value.toLowerCase();
    if (ours.has(key) || present.has(key)) {
      continue;
    }
    present.set(key, value);
  }
  return [...present.values()].sort((left, right) => left.localeCompare(right));
}

/**
 * Whose a thread is, judged only by the labels the configuration names.
 *
 * The narrowness is the point. A mailbox carries labels of several kinds at
 * once, and a thread marked `Archiv` is not thereby somebody else's work - it
 * is an unclaimed thread that somebody filed. Weighing every user label would
 * turn "has a label I do not recognise" into "not mine", and the threads lost
 * that way are lost silently.
 */
function assignmentOf(account: Account, labels: string[]): 'mine' | 'other' | 'none' | null {
  if (account.assignmentLabels.length === 0) {
    return null;
  }
  const mine = account.myLabel?.toLowerCase() ?? null;
  const known = new Set(account.assignmentLabels.map((name) => name.toLowerCase()));
  let claimed = false;
  for (const value of labels) {
    const key = value.toLowerCase();
    if (!known.has(key)) {
      continue;
    }
    if (mine !== null && key === mine) {
      // A thread can carry two people's labels when work is handed over. The
      // user's own wins: what matters to the reader is that it is also theirs.
      return 'mine';
    }
    claimed = true;
  }
  return claimed ? 'other' : 'none';
}

function received(message: PassMessage): number {
  return message.received_at === null ? 0 : Date.parse(message.received_at);
}

function lastActivity(thread: PassThread): number {
  return thread.last_received_at === null ? 0 : Date.parse(thread.last_received_at);
}
