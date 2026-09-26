// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karel Derfl

import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';

import type { Config } from '../config.js';
import { getMessage, saveAttachment } from '../gmail/body.js';
import { asJson, resolveAccount, runTool } from './shared.js';

const GET_MESSAGE_DESCRIPTION = [
  'Read one message, including a window of its body, addressed by its Message-ID.',
  'The body is returned in windows because on a long thread every reply carries the quoted history,',
  'so the text runs into hundreds of kilobytes. body_total_length is the whole length and',
  'body_truncated says whether there is more; ask for the next window with body_offset.',
  'Do not treat the quoted history in a reply as context: mobile clients cut it off,',
  'attachments are never quoted, and nothing in it says what is missing.',
  'The structure of a conversation comes from mg_get_thread, never from the quotes inside a message.',
  'Attachments are listed with a size but not downloaded; use mg_get_attachment for the ones worth having.',
].join(' ');

const GET_ATTACHMENT_DESCRIPTION = [
  'Download one attachment of a message and save it to disk, returning the path it was written to.',
  'The content is not returned inline, because an attachment is routinely megabytes.',
  'attachment_id comes from the attachments list of mg_get_message and belongs to that message.',
].join(' ');

export function registerReadMessageTools(server: McpServer, config: Config): void {
  server.registerTool(
    'mg_get_message',
    {
      description: GET_MESSAGE_DESCRIPTION,
      inputSchema: z.object({
        account: z.string().describe('Short name of the mailbox the message is in.'),
        message_id: z
          .string()
          .min(1)
          .describe('Message-ID from the header, with or without angle brackets. Not a uid.'),
        body_offset: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe('Where the returned window of the body starts, in characters.'),
        max_body_length: z
          .number()
          .int()
          .min(1)
          .max(200_000)
          .default(8_000)
          .describe('How many characters of the body to return.'),
      }),
    },
    async ({ account, message_id, body_offset, max_body_length }) =>
      runTool(async () => {
        const resolved = resolveAccount(config.accounts, account);
        return asJson(await getMessage(resolved, message_id, body_offset, max_body_length));
      }),
  );

  server.registerTool(
    'mg_get_attachment',
    {
      description: GET_ATTACHMENT_DESCRIPTION,
      inputSchema: z.object({
        account: z.string().describe('Short name of the mailbox the message is in.'),
        message_id: z
          .string()
          .min(1)
          .describe('Message-ID from the header, with or without angle brackets.'),
        attachment_id: z
          .string()
          .min(1)
          .describe('Attachment id from the attachments list of mg_get_message.'),
      }),
    },
    async ({ account, message_id, attachment_id }) =>
      runTool(async () => {
        const resolved = resolveAccount(config.accounts, account);
        return asJson(await saveAttachment(resolved, message_id, attachment_id, config.downloadDir));
      }),
  );
}
