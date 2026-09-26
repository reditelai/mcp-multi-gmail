// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karel Derfl

/**
 * Reading a whole thread.
 *
 * The thread id comes from Gmail itself (X-GM-THRID), so one search returns
 * every message of the thread and nothing has to be reconstructed from
 * In-Reply-To and References.
 */

import type { Account } from '../config.js';
import { ToolError } from '../errors.js';
import { toMessageSummary, type MessageSummary } from './message.js';
import { withAllMail } from './session.js';

export interface ThreadResult {
  account: string;
  thread_id: string;
  /** "native" - the thread comes from Gmail's own thread id, not from an estimate built out of headers. */
  thread_source: 'native';
  subject: string | null;
  /** Always the length of `messages`. */
  message_count: number;
  /**
   * How many messages have not been through a pass yet. Answers "is there
   * anything new here for me" without walking the list.
   *
   * There is deliberately no count of unread messages beside it. The \Seen
   * flag belongs to whoever opened the message in a mail client, which is not
   * the assistant, and on a shared mailbox unread does not mean unhandled.
   */
  unprocessed_messages: number;
  last_received_at: string | null;
  messages: MessageSummary[];
}

export async function getThread(account: Account, threadId: string): Promise<ThreadResult> {
  return withAllMail(account, async ({ client }) => {
    const uids = await client.search({ threadId }, { uid: true });
    if (uids === false || uids.length === 0) {
      throw new ToolError(
        'not_found',
        `No thread ${threadId} in mailbox "${account.name}". Thread ids come from mg_search_threads and belong ` +
          'to the mailbox they were found in.',
      );
    }

    // Every message of the thread, never the first few. A search result shows a
    // thread's beginning, so a thread whose newest visible message is a month
    // old can still hold an answer from today - the most common way a reply
    // gets overlooked. Only the body of a single message may ever be shortened.
    const fetched = await client.fetchAll(
      uids,
      { uid: true, threadId: true, internalDate: true, envelope: true, labels: true, flags: true, size: true },
      { uid: true },
    );

    const messages: MessageSummary[] = fetched
      .map((message) => toMessageSummary(account, message))
      .sort(byReceivedAt);

    const last = messages[messages.length - 1];
    return {
      account: account.name,
      thread_id: threadId,
      thread_source: 'native',
      subject: messages[0]?.subject ?? null,
      message_count: messages.length,
      unprocessed_messages: messages.filter((message) => !message.processed).length,
      last_received_at: last?.received_at ?? null,
      messages,
    };
  });
}

/** Oldest first, which is the order a conversation reads in. */
function byReceivedAt(left: MessageSummary, right: MessageSummary): number {
  const leftAt = left.received_at === null ? 0 : Date.parse(left.received_at);
  const rightAt = right.received_at === null ? 0 : Date.parse(right.received_at);
  return leftAt - rightAt;
}
