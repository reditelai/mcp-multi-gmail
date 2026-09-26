// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karel Derfl

/**
 * The IMAP flags of a single message.
 *
 * Flags are not labels and this module is not a second way to do labelling.
 * A flag is what a mail client shows to the person reading the mailbox: read,
 * starred, answered. The record of what has been through a pass lives in
 * a label instead, for the reason set out in ./labels.ts - the \Seen flag
 * belongs to whoever opened the message, and on a shared mailbox it says
 * little even about that.
 *
 * **Only three flags can be written here**, and the list is deliberately
 * closed. \Deleted is missing because marking it is not a flag change but a
 * deletion, and what that does to a Gmail message depends on a setting in the
 * user's account rather than on this server - see ./trash.ts. \Draft is
 * missing because clearing it on a message in Drafts would leave a message
 * that is neither a draft nor sent.
 *
 * The state asked for is the state reported: every change is read back, so a
 * STORE the server accepts but does not act on is an error rather than a
 * silent no-op.
 */

import type { ImapFlow } from 'imapflow';

import type { Account } from '../config.js';
import { ToolError } from '../errors.js';
import { findByMessageId, normaliseMessageId } from './lookup.js';
import { carriesName } from './message.js';
import { withAllMail } from './session.js';

/** The flags this server will write. Everything else is out of scope on purpose. */
export type WritableFlag = 'seen' | 'flagged' | 'answered';

const IMAP_NAME: Record<WritableFlag, string> = {
  seen: '\\Seen',
  flagged: '\\Flagged',
  answered: '\\Answered',
};

const WRITABLE_FLAGS: WritableFlag[] = ['seen', 'flagged', 'answered'];

/** The wanted state of each flag. A flag left out is not touched. */
export type FlagRequest = Partial<Record<WritableFlag, boolean>>;

export interface FlagChange {
  account: string;
  /** The stable reference to the message, as it was asked for. */
  message_id: string;
  /** Valid only within this folder and this operation. Not a reference to keep. */
  uid: number;
  /** Flags before the change, as the server reported them. */
  flags_before: string[];
  /** Flags afterwards, read back rather than assumed. */
  flags_after: string[];
  /** Flags this call actually changed. */
  changed: WritableFlag[];
  /** Flags that were asked for and already in the wanted state. */
  already_set: WritableFlag[];
}

export async function setFlags(
  account: Account,
  messageId: string,
  wanted: FlagRequest,
): Promise<FlagChange> {
  const requested = WRITABLE_FLAGS.filter((flag) => wanted[flag] !== undefined);
  if (requested.length === 0) {
    throw new ToolError(
      'not_found',
      'No flag was asked for. Pass at least one of seen, flagged or answered, set to true or false.',
    );
  }

  return withAllMail(
    account,
    async ({ client }) => {
      const found = await findByMessageId(client, account, messageId);
      const before = await readFlags(client, found.uid, account);

      const toAdd: string[] = [];
      const toRemove: string[] = [];
      const changed: WritableFlag[] = [];
      const alreadySet: WritableFlag[] = [];

      for (const flag of requested) {
        const target = wanted[flag] === true;
        if (carriesName(before, IMAP_NAME[flag]) === target) {
          alreadySet.push(flag);
          continue;
        }
        changed.push(flag);
        (target ? toAdd : toRemove).push(IMAP_NAME[flag]);
      }

      let accepted = true;
      if (toAdd.length > 0) {
        accepted = await client.messageFlagsAdd(String(found.uid), toAdd, { uid: true });
      }
      if (accepted && toRemove.length > 0) {
        accepted = await client.messageFlagsRemove(String(found.uid), toRemove, { uid: true });
      }
      if (!accepted) {
        throw new ToolError(
          'upstream_error',
          `Gmail refused the flag change on the message in mailbox "${account.name}".`,
        );
      }

      // Read back before reporting. The whole point of returning flags_after is
      // that it was measured, not that it was intended.
      const after = await readFlags(client, found.uid, account);
      const missed = requested.filter((flag) => carriesName(after, IMAP_NAME[flag]) !== (wanted[flag] === true));
      if (missed.length > 0) {
        throw new ToolError(
          'upstream_error',
          `Gmail did not apply ${missed.join(', ')} on the message in mailbox "${account.name}". ` +
            'The flags were read back after the change, so this is what the mailbox actually holds, ' +
            `not what was asked for: ${[...after].sort().join(', ')}.`,
        );
      }

      return {
        account: account.name,
        message_id: normaliseMessageId(messageId),
        uid: found.uid,
        flags_before: [...before].sort(),
        flags_after: [...after].sort(),
        changed,
        already_set: alreadySet,
      };
    },
    { readOnly: false },
  );
}

async function readFlags(client: ImapFlow, uid: number, account: Account): Promise<Set<string>> {
  const message = await client.fetchOne(String(uid), { uid: true, flags: true }, { uid: true });
  if (message === false) {
    throw new ToolError(
      'not_found',
      `The message disappeared from mailbox "${account.name}" while its flags were being changed.`,
    );
  }
  return message.flags ?? new Set<string>();
}
