// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karel Derfl

/**
 * Searching, and grouping the matches into threads.
 *
 * The query is handed to Gmail verbatim through X-GM-RAW, so the whole Gmail
 * search syntax is available and nothing has to be translated. That also means
 * no condition can be dropped on the way and turn a query into a different one
 * that still looks answered.
 *
 * Searching every mailbox at once is the reason this server exists, and the
 * rule that makes it usable is that **one mailbox failing does not lose the
 * others**. A mailbox whose password has expired is named in `failures` while
 * the rest of the answer stands. An empty answer in its place would read as
 * "there is nothing there", which is the wrong conclusion to hand anybody.
 */

import type { Account } from '../config.js';
import { ToolError, type ErrorCode } from '../errors.js';
import { carriesName, subjectOf, toMatchSummary, type MatchSummary } from './message.js';
import { withAllMail } from './session.js';

/**
 * How many matching messages will be grouped into threads in one call. Beyond
 * this the query is refused rather than answered from part of the matches,
 * because a partial answer here is indistinguishable from a complete one.
 *
 * The number is set to what the server can still deliver comfortably, not to
 * what is absurd. Grouping walks every match to read its thread id, and a walk
 * over tens of thousands of messages can outlast the connection's own timeout -
 * at which point the caller gets a broken connection instead of the sentence
 * telling them their query is too broad, which is the worse of the two answers.
 * A pass over new mail matches tens of messages; a month of catching up,
 * thousands.
 */
export const MAX_MATCHES = 5_000;

const DEFAULT_MAX_RESULTS = 25;
const HIGHEST_MAX_RESULTS = 100;

export interface ThreadMatch {
  account: string;
  thread_id: string;
  subject: string | null;
  /**
   * How many messages of this thread matched the query. This is NOT the size
   * of the thread: a thread of nine messages with one match reports 1. The
   * whole thread comes from mg_get_thread.
   */
  matched_messages: number;
  /**
   * How many of those matching messages still lack the processed label, read
   * from the messages themselves rather than from the search index.
   *
   * Gmail updates its search index some time after a label is written, so a
   * query for unlabelled mail keeps returning threads that were labelled a
   * moment ago. Whether there is anything new here is answered by this number,
   * never by the thread being in the results at all.
   */
  unprocessed_matches: number;
  /**
   * The most recently delivered matching message of the thread, narrowed to
   * what a result list is read for. The rest of it comes from mg_get_thread;
   * see MatchSummary for what is left out and why.
   */
  newest_match: MatchSummary;
}

export interface SearchThreadsResult {
  threads: ThreadMatch[];
  total_threads: number;
  next_page_token: string | null;
  /**
   * Threads that matched but could not be read back, almost always because the
   * message was deleted between the two passes. Reported rather than dropped.
   */
  unavailable_threads: string[];
}

/** One mailbox that could not answer. Reported beside the results, never instead of them. */
export interface AccountFailure {
  account: string;
  code: ErrorCode;
  message: string;
}

export interface SearchAllResult extends SearchThreadsResult {
  /** Mailboxes that answered. */
  searched: string[];
  failures: AccountFailure[];
}

interface ThreadGroup {
  threadId: string;
  /** UIDs of this thread's messages that matched the query, in no particular order. */
  uids: number[];
  newestUid: number;
  newestAt: number;
}

export const DEFAULT_PAGE = DEFAULT_MAX_RESULTS;

export function clampMaxResults(maxResults: number): number {
  return Math.min(Math.max(Math.trunc(maxResults), 1), HIGHEST_MAX_RESULTS);
}

/** Search one mailbox. */
export async function searchThreads(
  account: Account,
  query: string,
  maxResults = DEFAULT_MAX_RESULTS,
  pageToken?: string,
): Promise<SearchThreadsResult> {
  return searchThreadsPage(account, query, clampMaxResults(maxResults), parsePageToken(pageToken));
}

/**
 * Search every mailbox and merge the answers, newest activity first.
 *
 * Each mailbox is asked for the newest `offset + limit` threads, because that
 * is the most any single mailbox can contribute to the requested page once the
 * answers are merged and sorted.
 */
export async function searchAllThreads(
  accounts: Account[],
  query: string,
  maxResults = DEFAULT_MAX_RESULTS,
  pageToken?: string,
): Promise<SearchAllResult> {
  const limit = clampMaxResults(maxResults);
  const offset = parsePageToken(pageToken);

  const settled = await Promise.allSettled(
    accounts.map((account) => searchThreadsPage(account, query, offset + limit, 0)),
  );

  const merged: ThreadMatch[] = [];
  const unavailable: string[] = [];
  const failures: AccountFailure[] = [];
  const searched: string[] = [];
  let total = 0;

  for (const [index, result] of settled.entries()) {
    const account = accounts[index];
    if (account === undefined) {
      continue;
    }
    if (result.status === 'fulfilled') {
      searched.push(account.name);
      merged.push(...result.value.threads);
      unavailable.push(...result.value.unavailable_threads);
      total += result.value.total_threads;
    } else {
      failures.push(toAccountFailure(account, result.reason));
    }
  }

  merged.sort((left, right) => receivedAt(right) - receivedAt(left));
  const page = merged.slice(offset, offset + limit);
  const consumed = offset + page.length;

  return {
    threads: page,
    total_threads: total,
    next_page_token: consumed < total ? String(consumed) : null,
    unavailable_threads: unavailable,
    searched,
    failures,
  };
}

async function searchThreadsPage(
  account: Account,
  query: string,
  limit: number,
  offset: number,
): Promise<SearchThreadsResult> {
  return withAllMail(account, async ({ client }) => {
    const uids = await client.search({ gmraw: query }, { uid: true });
    if (uids === false || uids.length === 0) {
      return { threads: [], total_threads: 0, next_page_token: null, unavailable_threads: [] };
    }
    if (uids.length > MAX_MATCHES) {
      throw new ToolError(
        'query_too_broad',
        `The query matches ${uids.length} messages in mailbox "${account.name}", more than the ${MAX_MATCHES} ` +
          'this server will group into threads at once. Narrow it, for example with a shorter after: window.',
      );
    }

    // First pass: thread id and delivery time only, which is cheap per message.
    // It has to cover every match - grouping from a subset would leave whole
    // threads out of the answer without saying so.
    const groups = new Map<string, ThreadGroup>();
    for await (const message of client.fetch(
      uids,
      { uid: true, threadId: true, internalDate: true },
      { uid: true },
    )) {
      if (message.threadId === undefined) {
        throw new ToolError(
          'provider_unsupported',
          `Mailbox "${account.name}" returned a message without a thread id, so it does not support the Gmail ` +
            'X-GM-THRID extension. Threads cannot be built without it, and guessing them from headers is out of scope.',
        );
      }
      const at = toMillis(message.internalDate);
      const existing = groups.get(message.threadId);
      if (existing === undefined) {
        groups.set(message.threadId, {
          threadId: message.threadId,
          uids: [message.uid],
          newestUid: message.uid,
          newestAt: at,
        });
      } else {
        existing.uids.push(message.uid);
        if (at >= existing.newestAt) {
          existing.newestAt = at;
          existing.newestUid = message.uid;
        }
      }
    }

    const ordered = [...groups.values()].sort((left, right) => right.newestAt - left.newestAt);
    const page = ordered.slice(offset, offset + limit);

    // Second pass: headers, but only for the threads on this page. Size is not
    // asked for - nothing in the answer reports it any more.
    const summaries = new Map<number, { subject: string | null; match: MatchSummary }>();
    if (page.length > 0) {
      const fetched = await client.fetchAll(
        page.map((group) => group.newestUid),
        { uid: true, internalDate: true, envelope: true, labels: true, flags: true },
        { uid: true },
      );
      for (const message of fetched) {
        summaries.set(message.uid, { subject: subjectOf(message), match: toMatchSummary(account, message) });
      }
    }

    // The labels of every matching message on this page, asked for directly
    // rather than inferred from the query having matched. A FETCH answers from
    // the messages themselves and is current; the search index that produced
    // the match is updated only some time after a label is written, so it goes
    // on returning mail that has just been labelled. Labels only here, and
    // only for this page, so it stays one cheap command.
    const labelsByUid = new Map<number, Set<string>>();
    if (page.length > 0) {
      const matching = page.flatMap((group) => group.uids);
      const fetched = await client.fetchAll(matching, { uid: true, labels: true }, { uid: true });
      for (const message of fetched) {
        labelsByUid.set(message.uid, message.labels ?? new Set<string>());
      }
    }

    const threads: ThreadMatch[] = [];
    const unavailable: string[] = [];
    for (const group of page) {
      const newest = summaries.get(group.newestUid);
      if (newest === undefined) {
        unavailable.push(group.threadId);
        continue;
      }
      threads.push({
        account: account.name,
        thread_id: group.threadId,
        subject: newest.subject,
        matched_messages: group.uids.length,
        unprocessed_matches: countUnprocessed(group.uids, labelsByUid, account.processedLabel),
        newest_match: newest.match,
      });
    }

    const consumed = offset + page.length;
    return {
      threads,
      total_threads: ordered.length,
      next_page_token: consumed < ordered.length ? String(consumed) : null,
      unavailable_threads: unavailable,
    };
  });
}

/**
 * How many of a thread's matching messages still lack the processed label.
 *
 * A message whose labels could not be read counts as unprocessed. The safe
 * direction here is to show one message too many: a thread that turns out to be
 * done costs a glance, while one that is not done and stays hidden is the loss
 * this whole mechanism exists to prevent.
 */
function countUnprocessed(
  uids: number[],
  labelsByUid: Map<number, Set<string>>,
  processedLabel: string | null,
): number {
  let count = 0;
  for (const uid of uids) {
    const labels = labelsByUid.get(uid);
    if (processedLabel === null || labels === undefined || !carriesName(labels, processedLabel)) {
      count += 1;
    }
  }
  return count;
}

export function toAccountFailure(account: Account, reason: unknown): AccountFailure {
  if (reason instanceof ToolError) {
    return { account: account.name, code: reason.code, message: reason.message };
  }
  return {
    account: account.name,
    code: 'upstream_error',
    message: reason instanceof Error ? reason.message : String(reason),
  };
}

function receivedAt(match: ThreadMatch): number {
  const value = match.newest_match.received_at;
  return value === null ? 0 : Date.parse(value);
}

export function toMillis(value: Date | string | undefined): number {
  if (value === undefined) {
    return 0;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

/**
 * The page token is an offset into the thread list. It is only valid while the
 * mailboxes do not change: a message arriving between two pages shifts the
 * list, so a thread can be seen twice or skipped. Good enough for paging
 * through one answer, not a cursor to keep.
 */
export function parsePageToken(pageToken: string | undefined): number {
  if (pageToken === undefined || pageToken === '') {
    return 0;
  }
  if (!/^[0-9]+$/.test(pageToken)) {
    throw new ToolError('not_found', `"${pageToken}" is not a page token this server issued.`);
  }
  return Number.parseInt(pageToken, 10);
}
