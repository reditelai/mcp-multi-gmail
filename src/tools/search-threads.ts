// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karel Derfl

import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';

import type { Config } from '../config.js';
import { searchAllThreads, searchThreads } from '../gmail/search.js';
import { asJson, resolveAccount, runTool } from './shared.js';

const DESCRIPTION = [
  'Search Gmail mailboxes and return the matching threads, newest activity first.',
  'Pass account: "all" to search every configured mailbox at once - this is what answers',
  '"did I deal with this somewhere?", and every thread in the answer says which mailbox it came from.',
  'The query is the full Gmail search syntax, exactly as in the Gmail web interface',
  '(for example "after:2026/09/01 from:someone@example.com has:attachment"), and it is passed to Gmail unchanged.',
  'The whole mailbox is searched, not just the inbox, so archived mail is included;',
  'each message reports in_inbox so archived mail can be told apart.',
  'Note that matched_messages counts the messages of a thread that matched the query,',
  'NOT how many messages the thread has - call mg_get_thread to see the whole thread.',
  'unprocessed_matches says how many of those matching messages still lack the processed label,',
  'and it is read from the messages themselves rather than from the search index.',
  'Gmail updates that index some time after a label is written, so a query for unlabelled mail keeps',
  'returning threads that were labelled a moment ago. Decide whether a thread holds anything new',
  'by unprocessed_matches, never by the thread being in the results: zero means it is already done,',
  'so skip it without opening it.',
  'To work through mail that has not been through a pass, use mg_next_pass instead of writing that query',
  'here: it builds the two conditions itself from the mailbox own label and your boundary,',
  'so nothing can be added to them by accident. Never write a label name from memory -',
  'each mailbox names its own and mg_list_accounts reports it.',
  'With account: "all", check the failures list: a mailbox that could not be reached is named there',
  'and its mail is missing from the results, so an empty answer with failures does not mean there is nothing.',
  'Each thread carries newest_match, its most recent matching message, and that is a short summary on purpose:',
  'who it is from, when it arrived, its state, whether it is still in the inbox, and its message_id.',
  'This is the first of two stages and nothing is lost by it - mg_get_thread returns the whole thread',
  'and mg_get_message the body, so ask for those on the threads worth reading rather than expecting',
  'the search to carry everything.',
  'Store message_id, never uid: a uid stops being valid once the message is archived or moved,',
  'and search results carry no uid at all.',
].join(' ');

export function registerSearchThreads(server: McpServer, config: Config): void {
  server.registerTool(
    'mg_search_threads',
    {
      description: DESCRIPTION,
      inputSchema: z.object({
        account: z
          .string()
          .describe('Short name of the mailbox to search, as listed by mg_list_accounts, or "all" for every mailbox.'),
        query: z
          .string()
          .min(1)
          .describe('Gmail search query, in the same syntax as the Gmail search box.'),
        max_results: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(25)
          .describe('How many threads to return in one page.'),
        page_token: z
          .string()
          .optional()
          .describe('next_page_token from a previous call, to get the following page.'),
      }),
    },
    async ({ account, query, max_results, page_token }) =>
      runTool(async () => {
        if (account === 'all') {
          const result = await searchAllThreads(config.accounts, query, max_results, page_token);
          // Nothing found and nothing that answered are different outcomes, and
          // the difference matters more than either result on its own.
          const nothingAnswered = result.threads.length === 0 && result.failures.length > 0;
          return asJson(result, nothingAnswered);
        }
        const resolved = resolveAccount(config.accounts, account);
        return asJson(await searchThreads(resolved, query, max_results, page_token));
      }),
  );
}
