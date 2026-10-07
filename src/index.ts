#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karel Derfl

/**
 * mcp-multi-gmail - an MCP server giving an assistant access to several
 * separate Gmail mailboxes at once, through one connection.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

import { ConfigError, loadConfig, warnIfSecretsNotIgnored, type Config } from './config.js';
import { pendingWork } from './gmail/pass.js';
import { buildInstructions } from './instructions.js';
import { bundledVersion, miladkaRequired, outsideMiladka } from './location.js';
import { registerDraftTools } from './tools/drafts.js';
import { registerFlagTools } from './tools/flags.js';
import { registerGetThread } from './tools/get-thread.js';
import { registerLabelTools } from './tools/labels.js';
import { registerListAccounts } from './tools/list-accounts.js';
import { registerNextPass } from './tools/next-pass.js';
import { registerReadMessageTools } from './tools/read-message.js';
import { registerReloadConfig } from './tools/reload-config.js';
import { registerSearchThreads } from './tools/search-threads.js';
import { registerSendMessage } from './tools/send-message.js';
import { registerTrashTools } from './tools/trash.js';
import { DEFAULTS, EXIT, parseDuration, parseHours, runWatch, type Watched } from './watch.js';

const NAME = 'mcp-multi-gmail';
const VERSION = bundledVersion() ?? readVersion();

/**
 * The version from package.json, so it is written in one place only.
 *
 * Read relative to this file rather than to the working directory: dist/ sits
 * next to package.json both in a clone and in an installed package. A missing
 * or unreadable file is not a reason to refuse to start, so it falls back to a
 * value that says the version is not known.
 */
function readVersion(): string {
  try {
    const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    const version = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof version === 'string' ? version : '0.0.0-unknown';
  } catch {
    return '0.0.0-unknown';
  }
}

function resolveConfigPath(argv: string[]): string {
  const flag = argv.indexOf('--config');
  if (flag !== -1) {
    const value = argv[flag + 1];
    if (value === undefined) {
      throw new ConfigError('--config potřebuje cestu ke konfiguračnímu souboru.');
    }
    return value;
  }
  return process.env['MG_CONFIG'] ?? 'config.json';
}

/**
 * The waiting mode: see ./watch.ts. Everything goes to stdout as one line,
 * because that is what the assistant reads; a bad start is exit code 6, not a
 * crash-like 1 that would mean "start it again".
 */
async function waitMode(argv: string[]): Promise<number> {
  const say = (line: string): void => {
    process.stdout.write(`${line}\n`);
  };
  const outside = outsideMiladka();
  if (outside !== null) {
    say(`chyba: ${miladkaRequired()}`);
    return EXIT.usage;
  }
  let config: Config;
  try {
    config = await loadConfig(resolveConfigPath(argv));
  } catch (error) {
    say(`chyba: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT.usage;
  }

  const watched: Watched[] = [];
  const bad: string[] = [];
  const value = (flag: string): string | undefined => {
    const at = argv.indexOf(flag);
    return at === -1 ? undefined : argv[at + 1];
  };
  argv.forEach((arg, index) => {
    if (arg !== '--since') {
      return;
    }
    const pair = argv[index + 1] ?? '';
    const eq = pair.indexOf('=');
    const name = eq > 0 ? pair.slice(0, eq) : '';
    const since = new Date(pair.slice(eq + 1).trim());
    const account = config.accounts.find((candidate) => candidate.name === name);
    if (account === undefined) {
      bad.push(`--since "${pair}": schránka "${name}" v nastavení není (tvar --since jmeno=kotva)`);
    } else if (watched.some((entry) => entry.account.name === name)) {
      bad.push(`--since "${pair}": schránka "${name}" je uvedená dvakrát`);
    } else if (Number.isNaN(since.getTime())) {
      bad.push(`--since "${pair}": kotva není datum`);
    } else {
      watched.push({ account, since });
    }
  });
  // Which mailboxes are watched is set in config.json ("watch": true), in one
  // place. The assistant passes the boundary of every mailbox and the watcher
  // keeps the watched ones. A config with no "watch" at all (1.2) watches every
  // mailbox given on the command line, as before.
  const marked = config.accounts.filter((account) => account.watch);
  if (marked.length > 0 && bad.length === 0) {
    for (const account of marked) {
      if (!watched.some((entry) => entry.account.name === account.name)) {
        bad.push(`chybí kotva pro hlídanou schránku "${account.name}" (--since ${account.name}=kotva ze system/mail-kotva.md)`);
      }
    }
    watched.splice(0, watched.length, ...watched.filter((entry) => entry.account.watch));
  }
  if (watched.length === 0 && bad.length === 0) {
    bad.push('--wait potřebuje aspoň jedno --since jmeno=kotva (jméno schránky z mg_list_accounts, kotva z vaultu)');
  }

  let intervalMs = config.watchIntervalMs ?? DEFAULTS.intervalMs;
  const interval = value('--interval');
  if (interval !== undefined) {
    const parsed = parseDuration(interval);
    if (parsed === null || parsed < 60_000) {
      bad.push(`--interval "${interval}": čeká třeba 5m, nejméně 1m`);
    } else {
      intervalMs = parsed;
    }
  }
  let maxRunMs = DEFAULTS.maxRunMs;
  const max = value('--max');
  if (max !== undefined) {
    const parsed = parseDuration(max);
    if (parsed === null || parsed <= 0) {
      bad.push(`--max "${max}": čeká třeba 115m`);
    } else {
      maxRunMs = parsed;
    }
  }
  let hours: [number, number] | null = config.watchHours;
  const window = value('--hours');
  if (window !== undefined) {
    hours = parseHours(window);
    if (hours === null) {
      bad.push(`--hours "${window}": čeká rozsah hodin, třeba 9-19`);
    }
  }
  if (bad.length > 0) {
    say(`chyba: ${bad.join('; ')}`);
    return EXIT.usage;
  }

  // Next to the server file: in Miládka .doplnky/mcp-multi-gmail/, which is
  // not backed up. The state holds Message-IDs only.
  const here = dirname(fileURLToPath(import.meta.url));
  const controller = new AbortController();
  process.on('SIGTERM', () => controller.abort());
  process.on('SIGINT', () => controller.abort());
  return runWatch(
    watched,
    {
      ...DEFAULTS,
      intervalMs,
      maxRunMs,
      hours,
      claimPath: join(here, 'wait.owner'),
      statePath: join(here, 'wait-known.json'),
      check: pendingWork,
      log: (line) => process.stderr.write(`${line}\n`),
    },
    say,
    controller.signal,
  );
}

async function main(): Promise<void> {
  if (process.argv.includes('--version')) {
    // Without the settings, so that an update can tell the installed version
    // whatever state the settings are in.
    process.stdout.write(`${NAME} ${VERSION}\n`);
    return;
  }
  if (process.argv.includes('--wait')) {
    // exit, not return: an IMAP socket left behind must not keep the process alive.
    process.exit(await waitMode(process.argv.slice(2)));
  }
  const outside = outsideMiladka();
  if (outside !== null) {
    throw new ConfigError(miladkaRequired());
  }
  const configPath = resolveConfigPath(process.argv.slice(2));
  const config = await loadConfig(configPath);

  // Said before the server starts answering, so it is visible in the client's
  // log rather than buried after a run.
  for (const line of config.warnings) {
    process.stderr.write(`POZOR: ${line}\n`);
  }
  const warning = await warnIfSecretsNotIgnored(config.secretFiles);
  if (warning !== null) {
    process.stderr.write(`${warning}
`);
  }

  // Told to the client at initialize, so a client that passes them on puts them
  // in front of the model before it calls anything. Built from the
  // configuration, so the part about setting up labels is said only while they
  // are actually missing.
  const server = new McpServer(
    { name: NAME, version: VERSION },
    { instructions: buildInstructions(config, resolve(configPath)) },
  );
  registerListAccounts(server, config);
  registerNextPass(server, config);
  registerSearchThreads(server, config);
  registerGetThread(server, config);
  registerReadMessageTools(server, config);
  registerLabelTools(server, config);
  registerFlagTools(server, config);
  registerDraftTools(server, config);
  registerSendMessage(server, config);
  registerTrashTools(server, config);
  registerReloadConfig(server, config, configPath);

  await server.connect(new StdioServerTransport());

  // stdout is the protocol channel, so every diagnostic goes to stderr.
  process.stderr.write(`${NAME} ${VERSION} běží, nastavených schránek: ${config.accounts.length}, přílohy do: ${config.downloadDir}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof ConfigError ? error.message : (error as Error)?.stack ?? String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
