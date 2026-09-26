// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karel Derfl

import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';

import type { Config } from '../config.js';
import { getThread } from '../gmail/thread.js';
import { asJson, resolveAccount, runTool } from './shared.js';

const DESCRIPTION = [
  'Return EVERY message of one thread, oldest first, with the labels of each message.',
  'unprocessed_messages says how many messages have not been through a pass yet, and each message repeats it as processed;',
  'check that first. The seen field is the IMAP Seen flag from a mail client and is not a record of what you read.',
  'Use this on every thread id a search returned: search results show a thread by its newest matching message,',
  'so a thread can hold a reply that no listing revealed.',
  'Message bodies are not included; fetch a body with mg_get_message for the messages that need reading.',
  'message_count is always the number of messages returned - this tool never returns part of a thread.',
].join(' ');

export function registerGetThread(server: McpServer, config: Config): void {
  server.registerTool(
    'mg_get_thread',
    {
      description: DESCRIPTION,
      inputSchema: z.object({
        account: z
          .string()
          .describe('Short name of the mailbox the thread was found in.'),
        thread_id: z
          .string()
          .min(1)
          .describe('Thread id from mg_search_threads. Thread ids belong to the mailbox they were found in.'),
      }),
    },
    async ({ account, thread_id }) =>
      runTool(async () => {
        const resolved = resolveAccount(config.accounts, account);
        return asJson(await getThread(resolved, thread_id));
      }),
  );
}
