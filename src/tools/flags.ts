// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karel Derfl

/**
 * The flag tool.
 *
 * Flags are what a person sees in their mail client: read, starred, answered.
 * They are not where this server records its own work - that is a label, and
 * mg_label_message is the tool for it.
 */

import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';

import type { Config } from '../config.js';
import { setFlags } from '../gmail/flags.js';
import { asJson, resolveAccount, runTool } from './shared.js';

const DESCRIPTION = [
  'Set the IMAP flags of one message, addressed by its Message-ID.',
  'Each flag you pass is set to that value; the ones you leave out are not touched,',
  'and at least one has to be passed.',
  'seen is what the user sees as read or unread, flagged is the star in Gmail,',
  'and answered is the flag a mail client sets on a message that has been replied to.',
  'This is NOT where the record of what has been through a pass belongs:',
  'the \\Seen flag says a person opened the message in a mail client, and on a shared mailbox',
  'unread does not mean unhandled. Use mg_label_message with the mailbox processed_label for that.',
  'Deleting is not here either - flags cannot delete a message; mg_trash_message can.',
  'Flags are read back after the change, so a flag that did not take hold is an error, not a silent no-op.',
].join(' ');

export function registerFlagTools(server: McpServer, config: Config): void {
  server.registerTool(
    'mg_set_flags',
    {
      description: DESCRIPTION,
      inputSchema: z.object({
        account: z.string().describe('Short name of the mailbox the message is in.'),
        message_id: z
          .string()
          .min(1)
          .describe('Message-ID from the header, with or without angle brackets. Not a uid.'),
        seen: z
          .boolean()
          .optional()
          .describe('True marks the message read, false marks it unread. Left out, it is not touched.'),
        flagged: z
          .boolean()
          .optional()
          .describe('True stars the message in Gmail, false removes the star.'),
        answered: z
          .boolean()
          .optional()
          .describe('True marks the message as replied to, which is what a mail client shows as an answered message.'),
      }),
    },
    async ({ account, message_id, seen, flagged, answered }) =>
      runTool(async () => {
        const resolved = resolveAccount(config.accounts, account);
        return asJson(await setFlags(resolved, message_id, { seen, flagged, answered }));
      }),
  );
}
