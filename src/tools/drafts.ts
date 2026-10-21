// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Copyright 2026 Evermind Technologies s.r.o.

/**
 * The draft tools: writing one, and seeing what is already waiting.
 *
 * Both report `joined_thread`, and it is the field worth reading. A draft
 * written as a reply that is not in the thread it answers looks perfectly
 * ordinary until it is sent, and then it arrives as a new conversation.
 */

import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';

import { resolveAttachments } from '../attachments.js';
import type { Config } from '../config.js';
import { listDrafts, saveDraft } from '../gmail/draft.js';
import { asJson, resolveAccount, runTool } from './shared.js';

const SAVE_DESCRIPTION = [
  'Save a draft into the Drafts folder of a mailbox. Nothing is sent: the draft is left for the user',
  'to read and send themselves. To send instead, use mg_send_message, which is a separate tool',
  'and only works from a mailbox the configuration allows to send.',
  'To write a reply, pass in_reply_to with the Message-ID of the message being answered.',
  'The result reports joined_thread: if that is false, the draft did not attach to the thread',
  'and would go out as a separate message, which is worth fixing before the user sends it.',
  'Write html_body the way Gmail writes it - an outer <div dir="ltr">, each paragraph its own <div>,',
  'a blank line as <div><br></div> - and put the same wording in body without the tags.',
  'Gmail does not treat <p> as its own text and folds a draft built from those under the',
  '"show trimmed content" button, so it looks empty until the user clicks.',
  'A draft saved here cannot be checked by reading it back: the text always comes back intact,',
  'because what breaks it happens in Gmail. Ask the user how it looks instead.',
  'When they say a draft looks wrong - text folded away, or hard-wrapped mid-sentence after sending -',
  'ask whether their compose window is in plain text mode before changing anything. That mode throws',
  'the HTML part away and wraps the plain text on send, and the only sign of it is the words',
  '"Plain text" in the window title. It is their setting, not a fault here, and rewriting the draft',
  'will not help.',
  'from_alias sets the From header to another address, which has to be an alias already verified in Gmail;',
  'this server cannot verify one.',
  'To change a draft, save the corrected one with replaces set to the old draft\'s Message-ID;',
  'the old one goes to Trash. To pass a message on, use forward_of with its Message-ID and write only',
  'the new text in body: the original with its headers and attachments is added here. Its attachments',
  'come from the mailbox, so attachment_dirs does not limit them.',
  'Attaching files from disk works only from the directories attachment_dirs names,',
  'and with none configured it is off entirely - which holds for a draft as much as for a sent message,',
  'because a draft is composed the same way and is one send away from leaving the machine.',
  'When it is off, say so and leave it off: do NOT suggest turning it on or widening the directories.',
].join(' ');

const LIST_DESCRIPTION = [
  'List the drafts waiting in one mailbox, newest first.',
  'Each draft carries the same joined_thread check mg_save_draft makes, re-run against the mailbox as it is now:',
  'false means the draft answers a message but is not in its thread, so sending it would start',
  'a separate conversation instead of continuing that one. Null means it is not a reply,',
  'or that the message it answers is gone and there was nothing left to compare it with.',
  'This server cannot send an existing draft - SMTP has no such operation - so a draft listed here',
  'is sent by the user in Gmail, or, if they ask for it to go out now, composed again with',
  'mg_send_message and trashed afterwards, once that send has reported back.',
].join(' ');

export function registerDraftTools(server: McpServer, config: Config): void {
  server.registerTool(
    'mg_save_draft',
    {
      description: SAVE_DESCRIPTION,
      inputSchema: z.object({
        account: z.string().describe('Short name of the mailbox to save the draft in.'),
        to: z.array(z.email()).min(1).describe('Recipients.'),
        cc: z.array(z.email()).optional().describe('Copy recipients.'),
        bcc: z.array(z.email()).optional().describe('Blind copy recipients.'),
        subject: z.string().optional().describe('Subject line. Required, except with forward_of.'),
        body: z.string().describe('Plain text body.'),
        html_body: z
          .string()
          .optional()
          .describe('Optional HTML body. One is built from the plain text when this is omitted, so the draft has both halves and the HTML signature keeps its formatting; pass this only to shape the HTML yourself.'),
        in_reply_to: z
          .string()
          .optional()
          .describe('Message-ID of the message being replied to, with or without angle brackets.'),
        references: z
          .array(z.string())
          .optional()
          .describe('Message-IDs of the thread so far. Filled in from in_reply_to when omitted.'),
        forward_of: z
          .string()
          .optional()
          .describe(
            'Message-ID of a message to pass on. Its headers and body go under the new text and its attachments ' +
              'come along, the way a mail client forwards. Excludes in_reply_to. subject can then be left out: ' +
              'it becomes "Fwd: " and the original subject.',
          ),
        forward_attachments: z
          .union([z.boolean(), z.array(z.string().min(1))])
          .default(true)
          .describe(
            'With forward_of: which attachments of the original go along. true for all of them, false for none, ' +
              'or the attachment_id values mg_get_message lists for only some.',
          ),
        replaces: z
          .string()
          .optional()
          .describe(
            'Message-ID of a draft in this mailbox that this one replaces, from mg_list_drafts. The new draft ' +
              'is stored first and the old one then goes to Trash, so a correction leaves one draft, not two. ' +
              'Pass the same in_reply_to or forward_of as the old draft, or the correction leaves its thread. ' +
              'Gmail gives a draft a new Message-ID whenever the user opens it, so take it from mg_list_drafts.',
          ),
        quote_original: z
          .boolean()
          .default(true)
          .describe(
            'Whether to put the message being answered under the reply, quoted the way a mail client does. ' +
              'On by default, and ignored without in_reply_to. Only that one message is quoted; it already ' +
              'carries its own history.',
          ),
        signature: z
          .union([z.string().min(1), z.literal(false)])
          .optional()
          .describe(
            'Name of the signature to end with, from the ones mg_list_accounts lists for this mailbox and ' +
              'alias. Omit for the configured default, or pass false for none. Do not write the signature ' +
              'into body - it would then be in the message twice.',
          ),
        from_alias: z
          .email()
          .optional()
          .describe(
            'Address to write as, from the aliases mg_list_accounts lists for this mailbox. Each alias says ' +
              'what it is for and brings its own signature.',
          ),
        attachments: z
          .array(z.string().min(1))
          .optional()
          .describe(
            'Absolute paths of files to attach. Only files inside the configured attachment_dirs can be ' +
              'read; when none are configured, attaching is off. Paths, not content - an attachment is ' +
              'routinely megabytes.',
          ),
      }),
    },
    async ({
      account,
      to,
      cc,
      bcc,
      subject,
      body,
      html_body,
      in_reply_to,
      references,
      forward_of,
      forward_attachments,
      replaces,
      quote_original,
      signature,
      from_alias,
      attachments,
    }) =>
      runTool(async () => {
        const resolved = resolveAccount(config.accounts, account);
        const files = await resolveAttachments(config, attachments ?? []);
        const result = await saveDraft(resolved, {
          to,
          cc,
          bcc,
          subject,
          body,
          htmlBody: html_body,
          inReplyTo: in_reply_to,
          references,
          forwardOf: forward_of,
          forwardAttachments: forward_attachments,
          replaces,
          fromAlias: from_alias,
          attachments: files,
          quoteOriginal: quote_original,
          quoteLocale: config.quoteLocale,
          signature,
        });
        return asJson(result, result.warning !== null);
      }),
  );

  server.registerTool(
    'mg_list_drafts',
    {
      description: LIST_DESCRIPTION,
      inputSchema: z.object({
        account: z.string().describe('Short name of the mailbox, as listed by mg_list_accounts.'),
        max_results: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(25)
          .describe('How many drafts to return, newest first. total_drafts says how many there are.'),
      }),
    },
    async ({ account, max_results }) =>
      runTool(async () => {
        const resolved = resolveAccount(config.accounts, account);
        return asJson(await listDrafts(resolved, max_results));
      }),
  );
}
