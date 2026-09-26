// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karel Derfl

/**
 * Finding a message by its Message-ID.
 *
 * The Message-ID from the header is the only reference to a message that
 * survives archiving or a move between folders, so it is what the tools take
 * from a caller. A UID is valid only inside one folder, and archiving - which
 * is how people tidy their mail - changes it.
 */

import type { ImapFlow } from 'imapflow';

import type { Account } from '../config.js';
import { ToolError } from '../errors.js';

/** Accept the id with or without the angle brackets the RFC puts around it. */
export function normaliseMessageId(messageId: string): string {
  return messageId.trim().replace(/^</, '').replace(/>$/, '');
}

/**
 * Search the open folder for a Message-ID. Use this everywhere instead of a
 * SEARCH HEADER - see findByMessageId for why a header search loses messages.
 */
export async function searchByMessageId(client: ImapFlow, messageId: string): Promise<number[]> {
  const bare = normaliseMessageId(messageId);
  if (bare === '') {
    return [];
  }
  const uids = await client.search({ gmraw: `rfc822msgid:"${bare}"` }, { uid: true });
  return uids === false ? [] : uids;
}

export interface FoundMessage {
  uid: number;
  /**
   * How many copies of this Message-ID the folder holds. Normally 1. More than
   * that means the same message is in the mailbox twice, which happens when a
   * message is saved back into it, and the newest copy is used.
   */
  copies: number;
}

export async function findByMessageId(
  client: ImapFlow,
  account: Account,
  messageId: string,
): Promise<FoundMessage> {
  const bare = normaliseMessageId(messageId);
  if (bare === '') {
    throw new ToolError('not_found', 'An empty Message-ID cannot be looked up.');
  }

  // Looked up with Gmail's own rfc822msgid, in quotes, rather than with a
  // SEARCH HEADER.
  //
  // A header search cannot find an id containing a brace. In IMAP "{n}" opens a
  // literal, so a brace inside the searched value breaks the command apart -
  // and it breaks quietly: the server answers with no matches rather than an
  // error, so the message reads as one that does not exist.
  //
  // That is not a curiosity. Seznam, the second most used Czech mail provider,
  // puts braces in its message ids: of 37 messages from seznam.cz in one
  // mailbox over a year, 20 carried one, sometimes at the very end
  // (shaped like <3aB.9x2Q7.5KmPzYtRwq.8dLe{@seznam.cz>, an invented example).
  // Such a message could not be read, labelled or trashed - and a message that
  // cannot be labelled holds the pass boundary open for good.
  //
  // The quotes are what makes it work: rfc822msgid: without them fails on the
  // same messages. Checked against a real one on 16 September 2026.
  const uids = await client.search({ gmraw: `rfc822msgid:"${bare}"` }, { uid: true });
  if (uids === false || uids.length === 0) {
    throw new ToolError(
      'not_found',
      `No message with Message-ID <${bare}> in mailbox "${account.name}". Message-IDs belong to the mailbox ` +
        'they were found in, so a message from another mailbox will not be here.',
    );
  }

  return { uid: Math.max(...uids), copies: uids.length };
}
