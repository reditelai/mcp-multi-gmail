// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karel Derfl

/**
 * Error codes a tool can report.
 *
 * A tool says what went wrong rather than returning something that looks like
 * an answer. A result that looks valid and is not costs more than a refusal.
 */
export type ErrorCode =
  /** Login failed: wrong app password, app passwords switched off, or IMAP disabled. */
  | 'auth_failed'
  /** No mailbox of that short name is configured. */
  | 'account_unknown'
  /** The mailbox does not offer the Gmail IMAP extensions this server needs. */
  | 'provider_unsupported'
  /** The query matched more messages than can be grouped into threads in one call. */
  | 'query_too_broad'
  /** The thread or message does not exist in that mailbox. */
  | 'not_found'
  /** Asked for something this version does not do yet, rather than doing something else. */
  | 'not_implemented'
  /** The mailbox is not allowed to send, or not to those recipients. */
  | 'send_forbidden'
  /** The label is not one the configuration names, so these tools will not touch it. */
  | 'label_forbidden'
  /** Gmail answered with an error. */
  | 'upstream_error'
  /** config.json did not load at a reload; the settings in effect stay as they were. */
  | 'config_invalid';

export class ToolError extends Error {
  override name = 'ToolError';

  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}
