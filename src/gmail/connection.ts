// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karel Derfl

/**
 * The only place that speaks IMAP to Gmail.
 *
 * The three Gmail extensions this server stands on - X-GM-THRID (threads),
 * X-GM-RAW (search) and X-GM-LABELS (labels) - stay behind this module. Not
 * because another provider is planned, but so all three can be found and
 * changed in one place instead of being spread across the code.
 */

import { ImapFlow } from 'imapflow';
import type { Account } from '../config.js';

/**
 * Gmail is the only host this server connects to, and there is deliberately
 * no host option in the configuration. The three extensions above exist
 * nowhere else, so a mailbox at another provider would not fail outright -
 * it would return scrambled results, and output that looks valid and is not
 * is worse than a missing feature.
 */
const GMAIL_IMAP_HOST = 'imap.gmail.com';
const GMAIL_IMAP_PORT = 993;

/**
 * A mailbox that stops answering must not hold a call open indefinitely, so
 * every stage of the connection has a deadline. Without them one unreachable
 * mailbox would stall a query that the other mailboxes could still answer.
 */
const CONNECTION_TIMEOUT_MS = 30_000;
const GREETING_TIMEOUT_MS = 15_000;
const SOCKET_TIMEOUT_MS = 120_000;

export type FailureCode = 'auth_failed' | 'upstream_error';

/** One mailbox that did not answer. Reported alongside the results, never instead of them. */
export interface AccountFailure {
  account: string;
  code: FailureCode;
  message: string;
}

export function createClient(account: Account, verifyOnly = false): ImapFlow {
  const client = new ImapFlow({
    host: GMAIL_IMAP_HOST,
    port: GMAIL_IMAP_PORT,
    secure: true,
    auth: { user: account.address, pass: account.password },
    // stdout carries the MCP protocol. ImapFlow logs to stdout through pino
    // by default, which would corrupt the protocol stream, so logging is off.
    logger: false,
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
    ...(verifyOnly ? { verifyOnly: true } : {}),
  });
  // ImapFlow emits 'error' when the socket breaks after login (ECONNRESET, a
  // socket timeout). Without a listener Node takes it as unhandled and ends
  // the whole process - the MCP server in the middle of a conversation, which
  // the Claude app on Windows cannot reconnect, or the mail watcher. The
  // command in flight rejects by itself and is reported from there, so the
  // event only needs to be absorbed here (found in the 1.2.0 review).
  client.on('error', () => undefined);
  return client;
}

/**
 * Check that a mailbox can be logged into. Returns the failure instead of
 * throwing it, so that one mailbox with an expired password cannot stop the
 * others from being reported.
 */
export async function verifyAccount(account: Account): Promise<AccountFailure | null> {
  const client = createClient(account, true);
  try {
    await client.connect();
    return null;
  } catch (error) {
    return { account: account.name, ...describeFailure(error) };
  } finally {
    client.close();
  }
}

/** Verify every mailbox at once, so one slow mailbox does not hold up the rest. */
export async function verifyAccounts(accounts: Account[]): Promise<AccountFailure[]> {
  const results = await Promise.all(accounts.map((account) => verifyAccount(account)));
  return results.filter((result): result is AccountFailure => result !== null);
}

export function describeFailure(error: unknown): { code: FailureCode; message: string } {
  // ImapFlow raises AuthenticationFailure, which carries authenticationFailed.
  // Checked by property rather than by instanceof, so a version that moves the
  // class still classifies the error correctly.
  if (typeof error === 'object' && error !== null && 'authenticationFailed' in error) {
    const failure = error as { message?: string; response?: string; serverResponseCode?: string };
    // The message on the error itself is only "Command failed", which does not
    // say whether the password is wrong, app passwords are switched off or IMAP
    // is disabled for the mailbox. Gmail says that in its own response, so pass
    // that through instead of the generic text.
    const detail = failure.response ?? failure.message ?? 'authentication failed';
    return {
      code: 'auth_failed',
      message: failure.serverResponseCode ? `${detail} (${failure.serverResponseCode})` : detail,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { code: 'upstream_error', message };
}
