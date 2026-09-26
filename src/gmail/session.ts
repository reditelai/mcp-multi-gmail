// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karel Derfl

/**
 * Connecting to a mailbox and finding the folder to work in.
 *
 * Two decisions live here.
 *
 * **The whole mailbox is read, not INBOX.** On an account with filters most of
 * the traffic never touches INBOX, so anyone looking only there does not see
 * what the mailbox is doing. Whether a message is archived is told by the
 * presence of the Inbox label, not by which folder it sits in.
 *
 * **Folder paths are resolved, never written down.** Gmail localises its
 * folder names, so the folder called "[Gmail]/All Mail" on one account is
 * "[Gmail]/Všechny zprávy" on another. Paths come from the special-use flags
 * the server reports.
 */

import type { ImapFlow, ListResponse } from 'imapflow';

import type { Account } from '../config.js';
import { ToolError } from '../errors.js';
import { createClient, describeFailure } from './connection.js';

/** The folders this server works in, by the role they play rather than by name. */
export type FolderRole = 'all' | 'drafts' | 'sent' | 'trash';

const SPECIAL_USE: Record<FolderRole, string> = {
  all: '\\All',
  drafts: '\\Drafts',
  sent: '\\Sent',
  trash: '\\Trash',
};

const FOLDER_DESCRIPTION: Record<FolderRole, string> = {
  all: 'all-mail',
  drafts: 'drafts',
  sent: 'sent',
  trash: 'trash',
};

export interface ResolvedFolder {
  role: FolderRole;
  path: string;
  /**
   * How the path was determined. "extension" means the server named it through
   * SPECIAL-USE or XLIST. "name" means it was matched against a list of known
   * localised names, which is a guess and worth reporting.
   */
  source: 'extension' | 'name' | 'user' | 'unknown';
}

export interface MailboxSession {
  client: ImapFlow;
  account: Account;
  folder: ResolvedFolder;
}

export async function findFolder(client: ImapFlow, role: FolderRole): Promise<ResolvedFolder> {
  const folders: ListResponse[] = await client.list();
  const match = folders.find((folder) => folder.specialUse === SPECIAL_USE[role]);
  if (match === undefined) {
    throw new ToolError(
      'provider_unsupported',
      `This mailbox does not report a ${FOLDER_DESCRIPTION[role]} folder, which Gmail and Google Workspace ` +
        'always do. Check that IMAP is enabled and that the folder is shown in IMAP.',
    );
  }
  return { role, path: match.path, source: match.specialUseSource ?? 'unknown' };
}

/**
 * Connect, run the work, and close. No folder is opened, which is what
 * operations addressed by folder path (such as APPEND) need.
 */
export async function withClient<T>(account: Account, run: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = createClient(account);
  try {
    await client.connect();
  } catch (error) {
    // Nothing is open yet, but a half-open socket would keep the process alive
    // after the call returns, so it is dropped before the failure is reported.
    client.close();
    throw asToolError(error, account);
  }

  try {
    return await run(client);
  } catch (error) {
    throw asToolError(error, account);
  } finally {
    // A failed logout must not mask the real error, so fall back to dropping
    // the socket instead of letting it throw out of the finally block.
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
}

/**
 * Connect and open one folder.
 *
 * `readOnly` defaults to true, and every read path leaves it that way: opening
 * a folder for writing and then fetching would set the \Seen flag on messages
 * the assistant merely looked at, which changes the user's mailbox as a side
 * effect of reading it. Only operations that are meant to change something
 * ask for write access.
 */
export async function withFolder<T>(
  account: Account,
  role: FolderRole,
  run: (session: MailboxSession) => Promise<T>,
  options: { readOnly?: boolean } = {},
): Promise<T> {
  const readOnly = options.readOnly ?? true;
  return withClient(account, async (client) => {
    const folder = await findFolder(client, role);
    const lock = await client.getMailboxLock(folder.path, { readOnly });
    try {
      return await run({ client, account, folder });
    } finally {
      lock.release();
    }
  });
}

/** The all-mail folder, opened read-only unless asked otherwise. */
export async function withAllMail<T>(
  account: Account,
  run: (session: MailboxSession) => Promise<T>,
  options: { readOnly?: boolean } = {},
): Promise<T> {
  return withFolder(account, 'all', run, options);
}

function asToolError(error: unknown, account: Account): ToolError {
  if (error instanceof ToolError) {
    return error;
  }
  const failure = describeFailure(error);
  return new ToolError(failure.code, `Mailbox "${account.name}": ${failure.message}`);
}
