// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Copyright 2026 Evermind Technologies s.r.o.

import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';

import { resolveAttachments } from '../attachments.js';
import type { Config } from '../config.js';
import { sendMessage } from '../gmail/send.js';
import { asJson, resolveAccount, runTool } from './shared.js';

const DESCRIPTION = [
  'Send a message from one mailbox. THIS CANNOT BE UNDONE and it goes out under the account holder name,',
  'so make sure the user has asked for this message to be sent rather than drafted.',
  'If in doubt, use mg_save_draft instead and let them send it themselves.',
  'Sending only works from a mailbox whose can_send is true in mg_list_accounts,',
  'and only to recipients its allowed_recipients list permits.',
  'Check the result: accepted lists the recipients the message reached and rejected the ones it did not,',
  'and sent_copy says whether a copy reached the Sent folder - Gmail does not file SMTP mail by itself,',
  'so a message can go out and leave no trace in the mailbox. If sent_copy.saved is false,',
  'the message was still sent and must NOT be sent again.',
  'To reply inside a thread, pass in_reply_to with the Message-ID being answered.',
  'This tool cannot send an existing draft: SMTP has no such operation, so sending what a draft says',
  'means composing it again here. A draft written as a reply already has the quote in its body,',
  'so pass quote_original: false when sending its text - otherwise the history goes out twice.',
  'The signature is in there too: pass signature: false as well.',
  'A forwarded draft is different: send only its new text with the same forward_of, which adds the',
  'original and its attachments again - its text alone would go out without them.',
  'Send first and move the draft to Trash with mg_trash_message only',
  'afterwards, never the other way round - a trashing that fails leaves a visible duplicate, whereas',
  'trashing first and then failing to send loses the text with nothing left to recover it from.',
  'Clearing that draft away is right here, and is the exception mg_trash_message describes: the user',
  'asked for the message to go out, not for a copy of it to stay behind in Drafts.',
  'To pass a message on, use forward_of with its Message-ID and write only the new text in body:',
  'the original with its headers and attachments is added here. Its attachments come from the mailbox,',
  'so attachment_dirs does not limit them. Say in the reply which attachments went, from the result.',
  'Attaching files from disk works only from the directories attachment_dirs names,',
  'and with none configured it is off entirely. When it is off, say the message can go without the file',
  'or not at all - do NOT suggest turning it on, and do not suggest widening the directories either.',
  'It is the one thing here that can carry data off this machine, and mail is written by people outside it.',
  'Gmail refuses a message over 25 MB, and encoding makes attachments about a third larger than they are',
  'on disk, so a long thread may not fit.',
].join(' ');

export function registerSendMessage(server: McpServer, config: Config): void {
  server.registerTool(
    'mg_send_message',
    {
      description: DESCRIPTION,
      annotations: {
        title: 'Send an e-mail',
        readOnlyHint: false,
        // Not destructive in the sense of deleting anything, but it cannot be
        // taken back and it reaches people outside this machine.
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: z.object({
        account: z.string().describe('Short name of the mailbox to send from. Its can_send has to be true.'),
        to: z.array(z.email()).min(1).describe('Recipients.'),
        cc: z.array(z.email()).optional().describe('Copy recipients.'),
        bcc: z.array(z.email()).optional().describe('Blind copy recipients.'),
        subject: z.string().optional().describe('Subject line. Required, except with forward_of.'),
        body: z.string().describe('Plain text body.'),
        html_body: z
          .string()
          .optional()
          .describe(
            'Optional HTML body. One is built from the plain text when this is omitted, so a message always goes out with both halves and the HTML signature keeps its formatting; pass this only to shape the HTML yourself. Write it the way Gmail does - an outer ' +
              '<div dir="ltr">, each paragraph its own <div>, a blank line as <div><br></div> - so a reply ' +
              'quoting it looks the same as one quoting a message written in Gmail.',
          ),
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
        quote_original: z
          .boolean()
          .default(true)
          .describe(
            'Whether to put the message being answered under the reply, quoted the way a mail client does. ' +
              'On by default, and ignored without in_reply_to. Only that one message is quoted; it already ' +
              'carries its own history. Turn it off only when the recipient is asked for a bare reply.',
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
              'what it is for and brings its own signature. An address that is not listed is refused.',
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
      quote_original,
      signature,
      from_alias,
      attachments,
    }) =>
      runTool(async () => {
        const resolved = resolveAccount(config.accounts, account);
        // Read and checked before anything is sent, so a file that is missing
        // or out of bounds stops the message rather than arriving without it.
        const files = await resolveAttachments(config, attachments ?? []);
        const result = await sendMessage(resolved, {
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
          fromAlias: from_alias,
          attachments: files,
          quoteOriginal: quote_original,
          quoteLocale: config.quoteLocale,
          signature,
        });
        // A send that partly failed, or whose copy never reached Sent, is
        // flagged so it cannot be skimmed past as an ordinary success.
        return asJson(result, result.warning !== null);
      }),
  );
}
