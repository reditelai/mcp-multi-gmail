// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karel Derfl

/**
 * The trash tool.
 *
 * One message at a time, and no thread version of it. Labelling has a tool for
 * a whole thread because a classification is about the conversation; throwing
 * mail away is not, and a single call that empties a conversation is the kind
 * of operation that gets made by mistake once and regretted for a long time.
 */

import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';

import type { Config } from '../config.js';
import { trashMessage } from '../gmail/trash.js';
import { asJson, resolveAccount, runTool } from './shared.js';

const DESCRIPTION = [
  'Move one message to Trash, addressed by its Message-ID. One message, never a whole thread.',
  'The message is not deleted: Gmail keeps it in Trash for 30 days, where the user can restore it,',
  'and nothing in this server deletes mail permanently.',
  'This is still the user\'s mailbox, so use it when the user asked for this message to go,',
  'not to tidy up. The one exception is a draft whose text mg_send_message has just sent: the user',
  'asked for that message to go out, not for a copy of it to stay in Drafts, so trash it once the',
  'send has reported back - in that order, never before it.',
  'To record that a message has been through a pass, label it with mg_label_message',
  'and leave it where it is; to get it out of the inbox without throwing it away, archiving is',
  'the user\'s own business in Gmail.',
  'The message is looked for in Trash after the move, so a move that did not happen is an error',
  'rather than a cheerful report. Asking again for a message already in Trash is not an error:',
  'the result says moved: false and nothing is touched.',
].join(' ');

export function registerTrashTools(server: McpServer, config: Config): void {
  server.registerTool(
    'mg_trash_message',
    {
      description: DESCRIPTION,
      inputSchema: z.object({
        account: z.string().describe('Short name of the mailbox the message is in.'),
        message_id: z
          .string()
          .min(1)
          .describe('Message-ID from the header, with or without angle brackets. Not a uid.'),
      }),
    },
    async ({ account, message_id }) =>
      runTool(async () => {
        const resolved = resolveAccount(config.accounts, account);
        return asJson(await trashMessage(resolved, message_id));
      }),
  );
}
