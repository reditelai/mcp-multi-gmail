// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karel Derfl

import type { Account } from '../config.js';
import { ToolError } from '../errors.js';

/**
 * Declared as a type alias rather than an interface on purpose: the SDK's
 * result type carries an index signature, and TypeScript grants an implicit
 * one to type aliases but not to interfaces.
 */
export type ToolResponse = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

export function resolveAccount(accounts: Account[], name: string): Account {
  const account = accounts.find((candidate) => candidate.name === name);
  if (account === undefined) {
    const known = accounts.map((candidate) => candidate.name).join(', ');
    throw new ToolError(
      'account_unknown',
      `No mailbox called "${name}" is configured. Configured mailboxes: ${known}. Use mg_list_accounts to see them.`,
    );
  }
  return account;
}

export function asJson(payload: unknown, isError = false): ToolResponse {
  const response: ToolResponse = { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
  return isError ? { ...response, isError: true } : response;
}

/**
 * Run a tool and report a failure as a failure.
 *
 * A tool that cannot answer says so with a code and a sentence. Returning
 * something empty or partial that looks like an answer is worse, because
 * nothing downstream can tell it from the real thing.
 */
export async function runTool(work: () => Promise<ToolResponse>): Promise<ToolResponse> {
  try {
    return await work();
  } catch (error) {
    const payload =
      error instanceof ToolError
        ? { error: { code: error.code, message: error.message } }
        : { error: { code: 'upstream_error', message: error instanceof Error ? error.message : String(error) } };
    return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: true };
  }
}
