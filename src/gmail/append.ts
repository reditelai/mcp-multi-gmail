// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Copyright 2026 Evermind Technologies s.r.o.

/**
 * Putting a message into a folder as read.
 *
 * Drafts and the fallback copy in Sent are stored with \Seen. Without it Gmail
 * counts the message as unread mail, and a whole conversation shows as unread
 * because of a draft in it.
 *
 * **imapflow drops flags silently.** It passes on only the flags the folder
 * open at that moment allows. A folder opened read-only allows none, so after
 * looking up the message being replied to, a draft went in with no flags at
 * all and nothing said so (found by Věrka on 20 October 2026). The destination
 * is therefore opened for writing first, and the flag is read back afterwards
 * and set again when it is missing - the second half holds even if the first
 * one is ever undone by a change in the library.
 */

import type { ImapFlow } from 'imapflow';

export interface StoredAsRead {
  /** UID in the destination folder, or null when the server did not report one. */
  uid: number | null;
  /**
   * Whether the message carries \Seen, read back after storing. Null when
   * there was no UID to read it by.
   */
  seen: boolean | null;
}

/** APPEND the message with \Seen and make sure the flag held. False when the server refused the message. */
export async function appendAsRead(client: ImapFlow, path: string, raw: Buffer): Promise<StoredAsRead | false> {
  const lock = await client.getMailboxLock(path);
  try {
    const appended = await client.append(path, raw, ['\\Seen']);
    if (appended === false) {
      return false;
    }
    if (appended.uid === undefined) {
      return { uid: null, seen: null };
    }

    const uid = String(appended.uid);
    if (!(await carriesSeen(client, uid))) {
      await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
    }
    return { uid: appended.uid, seen: await carriesSeen(client, uid) };
  } finally {
    lock.release();
  }
}

async function carriesSeen(client: ImapFlow, uid: string): Promise<boolean> {
  const message = await client.fetchOne(uid, { uid: true, flags: true }, { uid: true });
  return message !== false && message.flags !== undefined && message.flags.has('\\Seen');
}
