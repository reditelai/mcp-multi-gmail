// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karel Derfl

/**
 * Reading config.json again while the server runs.
 *
 * The Claude app on Windows cannot reconnect a server, so a change of the
 * settings, an app password or a signature used to need a new conversation
 * (Karel, 30. 9. 2026). Every tool reads the one shared Config object when it is
 * called, so replacing its contents is enough. A file that does not load changes
 * nothing: the settings in effect stay, and the error says why.
 */

import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';

import { loadConfig, type Account, type Config } from '../config.js';
import { ToolError } from '../errors.js';
import { asJson, runTool } from './shared.js';

const DESCRIPTION = [
  'Read config.json again and apply it without a new conversation, after the user changed the settings,',
  'an app password or a signature (only with their consent, and never by reading the file with the',
  'passwords in it). Returns which mailboxes were added, removed or changed and whether the attachment',
  'settings changed; it never returns a password. A file that does not load changes nothing and the',
  'error says why. The mailbox list in this server\'s instructions is from the start of the conversation;',
  'mg_list_accounts shows the current one. Restart the --wait watcher afterwards so it uses the new settings.',
].join(' ');

export function registerReloadConfig(server: McpServer, config: Config, configPath: string): void {
  server.registerTool('mg_reload_config', { description: DESCRIPTION, inputSchema: z.object({}) }, async () =>
    runTool(async () => {
      let fresh: Config;
      try {
        fresh = await loadConfig(configPath);
      } catch (error) {
        throw new ToolError(
          'config_invalid',
          `${error instanceof Error ? error.message : String(error)} Nothing changed, the previous settings stay.`,
        );
      }
      const before = new Map(config.accounts.map((account) => [account.name, account]));
      const after = new Map(fresh.accounts.map((account) => [account.name, account]));
      const added = [...after.keys()].filter((name) => !before.has(name));
      const removed = [...before.keys()].filter((name) => !after.has(name));
      const changed = [...after.keys()].filter((name) => {
        const old = before.get(name);
        const now = after.get(name);
        return old !== undefined && now !== undefined && !sameAccount(old, now);
      });
      const watchSettings =
        JSON.stringify(fresh.watchHours) !== JSON.stringify(config.watchHours) ||
        fresh.watchIntervalMs !== config.watchIntervalMs;
      const attachments =
        fresh.downloadDir !== config.downloadDir ||
        JSON.stringify(fresh.attachmentDirs) !== JSON.stringify(config.attachmentDirs) ||
        fresh.quoteLocale !== config.quoteLocale;

      Object.assign(config, fresh);
      return asJson({
        reloaded: true,
        accounts: fresh.accounts.map((account) => account.name),
        accounts_added: added,
        accounts_removed: removed,
        accounts_changed: changed,
        attachments_or_quotes_changed: attachments,
        watch_settings_changed: watchSettings,
        next: 'Check the change with mg_list_accounts (verify: true after a new app password), then restart the --wait watcher.',
      });
    }),
  );
}

/** Compared without printing anything: a changed password shows up only as a changed mailbox. */
function sameAccount(left: Account, right: Account): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
