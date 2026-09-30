// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karel Derfl

/**
 * The labelling tools.
 *
 * There are separate tools for a message and for a thread, and the split is
 * not a convenience. Gmail's thread labelling also reaches messages that
 * arrive in the thread later, so the pass label put on a thread would mark
 * tomorrow's reply as already looked at before anyone read it - which is exactly
 * the kind of silent loss the split prevents.
 */

import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';

import type { Config } from '../config.js';
import { changeMessageLabels, changeThreadLabel, listLabels } from '../gmail/labels.js';
import { windowState } from '../gmail/pass.js';
import { parseSince } from './next-pass.js';
import { asJson, resolveAccount, runTool } from './shared.js';

const MESSAGE_NOTE = [
  'The processed_label from mg_list_accounts answers one question: has this message already been',
  'through a pass? That is what stops the next pass from reading the same mail over again,',
  'and it belongs on a single message because it says nothing about the rest of the thread.',
  'Label every message you looked at, including the ones that turned out to be noise and the ones',
  'still waiting for an answer: both have been looked at and neither needs reading again.',
  'It is not a verdict on the message. Whether anything still has to happen is a different question',
  'and belongs in a classification on the thread, with mg_label_thread.',
  'This tool takes ONLY the processed_label; a classification passed here is refused,',
  'because on a single message it would be invisible to the user - Gmail lists threads.',
  'A message you leave unlabelled comes back in every pass from now on - and worse, it holds the whole',
  'window open: a caller that only moves its time boundary once nothing in the window is unlabelled',
  'can never move it past a message you skipped, so the window grows and every pass gets more expensive.',
].join(' ');

const CLOSED_SET_NOTE = [
  'These tools only touch the labels the configuration names - the mailbox processed_label and its classification_labels, both listed by mg_list_accounts with what each one means. Any other label is refused in either direction: an undeclared label is never created, and a label the user put on a thread themselves is never taken off. To use a new one, add it to classification_labels in the configuration file (with the user\'s consent) and call mg_reload_config.',
].join(' ');

const BATCH_NOTE = [
  'Pass every message you want labelled in one call rather than calling this once per message:',
  'each call opens its own connection to Gmail, so forty calls means forty logins.',
  'The result reports each message separately with its own outcome - changed, already, not_found or failed -',
  'and succeeded and failed counts. A message that could not be labelled does not fail the call',
  'and is not hidden inside an overall success; read the list. Labelling a message that already carries',
  'the label is not an error and comes back as already, so repeating an interrupted pass is safe.',
].join(' ');

const THREAD_NOTE = [
  'A classification belongs to the whole conversation and Gmail also applies it to messages that arrive',
  'in the thread later - which is right for a classification, because a new message in a thread that is',
  'action is action too, and wrong for the record of what has been through a pass.',
  'A thread carries ONE classification and they exclude each other, so this SETS it:',
  'the one you give goes on and every other configured classification comes off in the same call.',
  'Do not take the old one off first - two calls would leave a moment where the thread is in two',
  'categories or in none, and a thread in no category reads as one nobody has looked at yet.',
  'classification_before and classification_after in the result say what it was and what it is now,',
  'and mg_next_pass reports the same per thread, so you can see what you are changing from.',
  'This tool takes only classifications; the label that records a pass goes on the messages',
  'with mg_label_message.',
].join(' ');

export function registerLabelTools(server: McpServer, config: Config): void {
  server.registerTool(
    'mg_list_labels',
    {
      description: [
        'List the labels and folders of one mailbox.',
        'System entries maintained by Gmail (All Mail, Sent, Trash and the like) are marked with system: true;',
        'the rest are labels that can be applied with mg_label_message and mg_label_thread.',
      ].join(' '),
      inputSchema: z.object({
        account: z.string().describe('Short name of the mailbox, as listed by mg_list_accounts.'),
      }),
    },
    async ({ account }) =>
      runTool(async () => {
        const resolved = resolveAccount(config.accounts, account);
        return asJson({ account: resolved.name, labels: await listLabels(resolved) });
      }),
  );

  server.registerTool(
    'mg_label_message',
    {
      description: `Add a label to one or more messages, addressed by their Message-IDs. ${MESSAGE_NOTE} ${BATCH_NOTE} ${CLOSED_SET_NOTE} The label is created if it does not exist, and every change is read back from the messages themselves before it is reported. Pass since - the same boundary as in mg_next_pass - on the last labelling of a pass, and the answer also carries window (window_clear, searched_at, oldest_unprocessed_at) as a new mg_next_pass would report it after the labelling, so no second pass is needed only to learn whether the boundary may move.`,
      inputSchema: z.object({
        account: z.string().describe('Short name of the mailbox the messages are in.'),
        message_ids: z
          .array(z.string().min(1))
          .min(1)
          .describe('Message-IDs from the headers, with or without angle brackets. Not uids.'),
        label: z.string().min(1).describe('The processed_label of this mailbox, from mg_list_accounts.'),
        since: z
          .string()
          .optional()
          .describe('The pass boundary, as given to mg_next_pass. When set, the answer carries the window state after the labelling.'),
      }),
    },
    async ({ account, message_ids, label, since }) =>
      runTool(async () => {
        const resolved = resolveAccount(config.accounts, account);
        const boundary = since === undefined ? null : parseSince(since);
        const result = await changeMessageLabels(resolved, message_ids, label, 'added');
        if (boundary === null) {
          return asJson(result);
        }
        return asJson({ ...result, window: await windowState(resolved, boundary) });
      }),
  );

  server.registerTool(
    'mg_unlabel_message',
    {
      description: `Remove a label from one or more messages, addressed by their Message-IDs. Every change is read back before it is reported. ${MESSAGE_NOTE} ${BATCH_NOTE} ${CLOSED_SET_NOTE}`,
      inputSchema: z.object({
        account: z.string().describe('Short name of the mailbox the messages are in.'),
        message_ids: z
          .array(z.string().min(1))
          .min(1)
          .describe('Message-IDs from the headers, with or without angle brackets. Not uids.'),
        label: z.string().min(1).describe('A label configured for this mailbox, from mg_list_accounts.'),
      }),
    },
    async ({ account, message_ids, label }) =>
      runTool(async () => {
        const resolved = resolveAccount(config.accounts, account);
        return asJson(await changeMessageLabels(resolved, message_ids, label, 'removed'));
      }),
  );

  server.registerTool(
    'mg_label_thread',
    {
      description: `Set the classification of one thread. ${THREAD_NOTE} ${CLOSED_SET_NOTE} The label is created if it does not exist, and the change is read back from the messages before it is reported.`,
      inputSchema: z.object({
        account: z.string().describe('Short name of the mailbox the thread is in.'),
        thread_id: z.string().min(1).describe('Thread id from mg_search_threads or mg_get_thread.'),
        label: z.string().min(1).describe('One of the classification_labels of this mailbox, from mg_list_accounts.'),
      }),
    },
    async ({ account, thread_id, label }) =>
      runTool(async () => {
        const resolved = resolveAccount(config.accounts, account);
        return asJson(await changeThreadLabel(resolved, thread_id, label, 'added'));
      }),
  );

  server.registerTool(
    'mg_unlabel_thread',
    {
      description: `Take the classification off one thread, leaving it unclassified. Use this only for a thread that should carry none: to change one classification for another, call mg_label_thread with the new one, which replaces the old in a single call. The change is read back before it is reported. ${THREAD_NOTE} ${CLOSED_SET_NOTE}`,
      inputSchema: z.object({
        account: z.string().describe('Short name of the mailbox the thread is in.'),
        thread_id: z.string().min(1).describe('Thread id from mg_search_threads or mg_get_thread.'),
        label: z.string().min(1).describe('A label configured for this mailbox, from mg_list_accounts.'),
      }),
    },
    async ({ account, thread_id, label }) =>
      runTool(async () => {
        const resolved = resolveAccount(config.accounts, account);
        return asJson(await changeThreadLabel(resolved, thread_id, label, 'removed'));
      }),
  );
}
