// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karel Derfl

import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';

import type { Config } from '../config.js';
import { verifyAccounts } from '../gmail/connection.js';
import { probeSmtp } from '../gmail/send.js';

const DESCRIPTION = [
  'List the configured Gmail mailboxes.',
  'Returns the short name of each mailbox, its address, whether it is shared with other people,',
  'and whether this server may send from it.',
  'work_scope says how much of the mailbox a pass treats as work: "everything", or "inbox" on a team',
  'mailbox, where the archive is what somebody filed and the sent folder holds other people\'s replies.',
  'What falls outside is counted, never holds the boundary back, and shows up only beside a thread that is',
  'work for another reason. Read it before concluding that mail is missing - not arriving and being out of',
  'scope look the same from here.',
  'unread_only says the pass ignores mail already marked read, which suits a mailbox whose traffic something',
  'else processes and where unread is what "nobody got to it" looks like. Those messages are counted with the',
  'rest of what is out of scope.',
  'assignment_labels are the labels this mailbox uses to say who is handling a thread, and my_label is the',
  'one that means the user. When they are set, mg_next_pass reports assigned: mine, other or none for every',
  'thread, so a thread somebody else has taken can be labelled and left without being opened. A label outside',
  'that list never makes a thread somebody else\'s - it leaves it unclaimed.',
  'The short name is what every other mg_ tool takes as its `account` argument;',
  'the string "all" addresses every mailbox at once.',
  'processed_label is the label that marks a message as already through a pass, and classification_labels',
  'are the labels this mailbox may put on a conversation, each with what it means - those two sets are',
  'the only labels mg_label_message and mg_label_thread will touch, in either direction.',
  'aliases are the addresses a mailbox may write as, each with what it is for: read purpose before choosing',
  'one, and pass the address as from_alias. An address not listed there is refused, and so is a signature',
  'name outside signatures. Each alias names the signature it goes out with unless another one is asked for.',
  'Set verify to true to also log in to each mailbox and check its app password, and for every mailbox',
  'that may send, check sending too: smtp lists the port that works (465, or 587 where the network blocks',
  '465), and a failure with check "smtp" means reading works but sending would not.',
].join(' ');

export function registerListAccounts(server: McpServer, config: Config): void {
  server.registerTool(
    'mg_list_accounts',
    {
      description: DESCRIPTION,
      inputSchema: z.object({
        verify: z
          .boolean()
          .default(false)
          .describe('Log in to every mailbox (and its sending, where it may send) to check it works. Slower; off by default.'),
      }),
    },
    async ({ verify }) => {
      const listed = config.accounts.map((account) => ({
        account: account.name,
        address: account.address,
        shared: account.shared,
        // How much of the mailbox a pass counts as work. Without it, mail that
        // never arrives looks the same as mail that is deliberately out of scope.
        work_scope: account.workScope,
        unread_only: account.unreadOnly,
        // Which labels say who is handling a thread, and which one is the user.
        // Without them a pass never reports assignment at all.
        assignment_labels: account.assignmentLabels,
        my_label: account.myLabel,
        can_send: account.canSend,
        allowed_recipients: account.allowedRecipients,
        processed_label: account.processedLabel,
        classification_labels: account.classificationLabels,
        // Names only. A signature is long and the same for every message, so
        // returning the text here would spend it on every listing and teach
        // the caller to paste it into a body by hand.
        signatures: Object.keys(account.signatures),
        default_signature: account.defaultSignature,
        aliases: account.aliases.map((alias) => ({
          address: alias.address,
          name: alias.name,
          purpose: alias.purpose,
          default_signature: alias.defaultSignature,
        })),
        // Whether the mail watcher (--wait) watches this mailbox, as set in
        // config.json - so the assistant never has to open that file.
        watch: account.watch,
      }));

      // Failures are reported next to the results, never instead of them: an
      // empty answer reads as "there is nothing there", which is worse than a
      // partial one that names what went wrong.
      const failures: Array<{ account: string; code: string; message: string; check: 'imap' | 'smtp' }> = [];
      const smtp: Array<{ account: string; port: number }> = [];
      if (verify) {
        const [imap, probes] = await Promise.all([
          verifyAccounts(config.accounts),
          // Sending is checked only where it may happen. A probe logs in and
          // sends nothing.
          Promise.all(
            config.accounts
              .filter((account) => account.canSend)
              .map(async (account) => ({ account: account.name, probe: await probeSmtp(account) })),
          ),
        ]);
        failures.push(...imap.map((failure) => ({ ...failure, check: 'imap' as const })));
        for (const { account, probe } of probes) {
          if (probe.ok) smtp.push({ account, port: probe.port });
          else failures.push({ account, code: probe.code, message: probe.message, check: 'smtp' });
        }
      }

      const payload = {
        accounts: listed,
        watch_hours: config.watchHours === null ? null : `${config.watchHours[0]}-${config.watchHours[1]}`,
        watch_interval_minutes: config.watchIntervalMs === null ? null : config.watchIntervalMs / 60_000,
        ...(verify ? { verified: true, smtp, failures } : {}),
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
      };
    },
  );
}
