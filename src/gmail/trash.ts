// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karel Derfl

/**
 * Moving one message to the Trash folder.
 *
 * **This is the only operation in the server that takes mail out of the
 * mailbox, and it is written to be recoverable.** Gmail keeps a trashed
 * message for 30 days, so the user can put it back; nothing here deletes a
 * message for good, and nothing here is offered for a whole thread.
 *
 * It moves the message rather than marking it \Deleted, and the difference
 * matters. What Gmail does with a message that a client marks \Deleted and
 * expunges is decided by a setting in the user's own IMAP options - archive
 * it, trash it, or delete it forever - so the same call would do three
 * different things on three accounts, one of them irreversible. A MOVE to the
 * folder the server itself reports as \Trash does one thing everywhere.
 *
 * Gmail advertises the IMAP MOVE extension only after login, so a capability
 * list read before authenticating does not show it. Where it is missing,
 * ImapFlow falls back to copy-and-delete on its own; either way the message is
 * looked for in Trash afterwards, and a move that did not happen is an error
 * rather than a cheerful report.
 */

import type { ImapFlow } from 'imapflow';

import type { Account } from '../config.js';
import { ToolError } from '../errors.js';
import { normaliseMessageId, searchByMessageId } from './lookup.js';
import { findFolder, withClient } from './session.js';

export interface TrashResult {
  account: string;
  /** The stable reference to the message, as it was asked for. */
  message_id: string;
  /** The trash folder as this mailbox names it; Gmail localises the name. */
  folder: string;
  /** False when the message was already in the trash, so nothing had to move. */
  moved: boolean;
  /** UID inside the trash folder. A working identifier for this operation, not a reference to keep. */
  uid_in_trash: number;
  note: string;
}

const RECOVERY_NOTE =
  'The message is in Trash, not deleted. Gmail keeps it there for 30 days and then removes it for good; ' +
  'until then the user can restore it from Trash in Gmail.';

export async function trashMessage(account: Account, messageId: string): Promise<TrashResult> {
  const bare = normaliseMessageId(messageId);
  if (bare === '') {
    throw new ToolError('not_found', 'An empty Message-ID cannot be looked up.');
  }

  return withClient(account, async (client) => {
    // Both paths are resolved before anything is opened, because Gmail localises
    // folder names and a lock cannot be held while another folder is opened.
    const allMail = await findFolder(client, 'all');
    const trash = await findFolder(client, 'trash');

    let moved = false;
    const allMailLock = await client.getMailboxLock(allMail.path, { readOnly: false });
    try {
      const uid = await uidOf(client, bare);
      if (uid !== null) {
        const result = await client.messageMove(String(uid), trash.path, { uid: true });
        if (result === false) {
          throw new ToolError(
            'upstream_error',
            `Gmail refused to move <${bare}> from "${allMail.path}" to "${trash.path}" in mailbox ` +
              `"${account.name}". The message has not been touched.`,
          );
        }
        moved = true;
      }
    } finally {
      allMailLock.release();
    }

    const trashLock = await client.getMailboxLock(trash.path, { readOnly: true });
    try {
      const uidInTrash = await uidOf(client, bare);

      if (uidInTrash === null && !moved) {
        // Not in all-mail and not in Trash: the message is not in this mailbox
        // at all. Said plainly, because a Message-ID belongs to the mailbox it
        // was read from and one from another mailbox will never be found here.
        throw new ToolError(
          'not_found',
          `No message with Message-ID <${bare}> in mailbox "${account.name}", neither in the mail itself nor ` +
            'in Trash. Message-IDs belong to the mailbox they were found in, so one from another mailbox will ' +
            'not be here.',
        );
      }

      if (uidInTrash === null) {
        throw new ToolError(
          'upstream_error',
          `Gmail accepted the move of <${bare}> out of "${allMail.path}" in mailbox "${account.name}", but the ` +
            `message is not in "${trash.path}" afterwards. Where it went cannot be told from here, so check the ` +
            'mailbox in Gmail before doing anything else - this was read back, not assumed.',
        );
      }

      return {
        account: account.name,
        message_id: bare,
        folder: trash.path,
        moved,
        uid_in_trash: uidInTrash,
        note: moved ? RECOVERY_NOTE : `The message was already in Trash, so nothing was moved. ${RECOVERY_NOTE}`,
      };
    } finally {
      trashLock.release();
    }
  });
}

/** The UID of a message in the folder currently open, or null when it is not there. */
async function uidOf(client: ImapFlow, messageId: string): Promise<number | null> {
  const uids = await searchByMessageId(client, messageId);
  if (uids.length === 0) {
    return null;
  }
  // The newest copy, the same choice findByMessageId makes when a mailbox
  // holds the same Message-ID more than once.
  return Math.max(...uids);
}
