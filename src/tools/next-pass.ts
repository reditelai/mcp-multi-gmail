// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karel Derfl

/**
 * The pass tool.
 *
 * It takes no query. That is the reason it exists beside mg_search_threads:
 * the pass query has exactly two conditions and there is no parameter here
 * through which a third one could arrive.
 */

import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';

import type { Config } from '../config.js';
import { ToolError } from '../errors.js';
import { runPass, runPassEverywhere } from '../gmail/pass.js';
import { asJson, resolveAccount, runTool } from './shared.js';

const DESCRIPTION = [
  'Return the threads that hold mail which has not been through a pass yet. This is the tool for',
  'working through new mail; mg_search_threads is for finding a particular thing.',
  'There is deliberately no query: the pass asks for exactly two things - not carrying the processed label,',
  'and delivered since the boundary you give - and nothing may be added.',
  'Gmail weighs conditions per message rather than per thread, so one extra condition such as from:',
  'drops a thread whose unprocessed message happens to be from somebody else,',
  'and the answer comes back looking like a clean empty result.',
  'Work through one mailbox at a time, each with its own boundary: account: "all" is accepted, but it returns a single window_clear and searched_at for every mailbox together, so one mailbox with unprocessed mail holds the boundary back for all of them.',
  'What comes back is only the threads with real work in them. Each one carries its unprocessed messages',
  'with sender, recipients and copies kept apart - being only in copy usually means the thing belongs',
  'to somebody else - and whether the message is still in the inbox or archived.',
  'message_count is the size of the whole thread: when it is larger than the unprocessed messages shown,',
  'read the thread with mg_get_thread before answering, because you are seeing part of a conversation.',
  'It is null when the mailbox would not say how long the thread is; treat that the same way and read it.',
  'pending_outgoing lists drafts and scheduled messages in that thread, so you do not write a second answer',
  'to something already waiting on a timer.',
  'user_labels are the labels on the thread that this server does not manage - what the people using the',
  'mailbox put there themselves, with system labels, the processed label and the classifications left out.',
  'On a shared mailbox that is how a thread says who is handling it, and reading it costs nothing,',
  'so a thread that belongs to somebody else can be labelled and left without opening it.',
  'What those labels mean is not something this server knows: acting on them is your judgement.',
  'assigned answers the same question where the mailbox names its assignment labels: mine, other or none -',
  'a thread claimed by the user, claimed by somebody else, or claimed by nobody. It is null where the mailbox',
  'does not work that way, which is not the same as none. Only the configured labels count, so an archive or',
  'a folder label leaves a thread unclaimed rather than making it somebody else\'s.',
  'Label every message you looked at with mg_label_message, the noise included, and pass them in one call.',
  'Then move your boundary to searched_at, but ONLY when window_clear is true.',
  'window_clear says nothing in the window is unprocessed; while it is false, oldest_unprocessed_at is the',
  'delivery time of the oldest message still waiting, and if that stops moving between passes,',
  'something in the window cannot be labelled and the window will grow until somebody looks.',
  'stale_threads counts threads that matched but turned out to carry the label already, which happens',
  'because Gmail updates its search index some time after a label is written; they are not returned',
  'and reading them again would be work for nothing.',
  'Drafts and scheduled messages are counted but never treated as work: they are the user\'s own writing,',
  'they never hold the boundary back, and they do not need labelling - editing a draft replaces the message,',
  'so a label on it would not survive anyway.',
  'A mailbox can also be scoped to its inbox, which is what a team mailbox wants: there the archive is what',
  'somebody filed and the sent folder holds other people\'s replies to other people\'s threads. Messages outside',
  'the scope are counted in outside_scope_in_window, never make a thread work on their own and never hold the',
  'boundary back - but a thread that is work for another reason still lists them, so "this is archived" or',
  '"somebody has already answered" is visible without opening it. mg_list_accounts reports the scope.',
].join(' ');

const SINCE_DESCRIPTION = [
  'The boundary: the date up to which the mail is provably dealt with, in full.',
  'This is NOT "since the last run" - a pass that ended with something still unlabelled leaves the boundary',
  'where it was. Move it only when a pass comes back with window_clear true, and then to that pass\'s',
  'searched_at. On the very first pass there is no boundary yet; use the day the server was set up,',
  'because mail older than that will never carry the label and would be walked over on every pass for ever.',
  'Written as YYYY-MM-DD or a full timestamp. The window goes by delivery time, not by the Date header,',
  'so mail forwarded today but written last month is in it.',
].join(' ');

export function registerNextPass(server: McpServer, config: Config): void {
  server.registerTool(
    'mg_next_pass',
    {
      description: DESCRIPTION,
      inputSchema: z.object({
        account: z
          .string()
          .describe('Short name of the mailbox, as listed by mg_list_accounts, or "all" for every mailbox.'),
        since: z.string().min(1).describe(SINCE_DESCRIPTION),
        max_threads: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(25)
          .describe('How many threads to return in one page. total_threads says how many there are.'),
        page_token: z
          .string()
          .optional()
          .describe('next_page_token from a previous call, to get the following page.'),
      }),
    },
    async ({ account, since, max_threads, page_token }) =>
      runTool(async () => {
        const boundary = parseSince(since);
        if (account === 'all') {
          return asJson(await runPassEverywhere(config.accounts, boundary, max_threads, page_token));
        }
        const resolved = resolveAccount(config.accounts, account);
        return asJson(await runPass(resolved, boundary, max_threads, page_token));
      }),
  );
}

/**
 * A boundary that cannot be read is refused rather than guessed at. Falling
 * back to a default would answer a different question than the one asked, and
 * the answer would look exactly like the right one.
 */
export function parseSince(since: string): Date {
  const parsed = new Date(since.trim());
  if (Number.isNaN(parsed.getTime())) {
    throw new ToolError(
      'not_found',
      `"${since}" is not a date this server can read. Give the boundary as YYYY-MM-DD, for example ` +
        '"2026-09-01", or as a full timestamp.',
    );
  }
  return parsed;
}
