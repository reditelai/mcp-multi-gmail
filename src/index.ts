#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karel Derfl

/**
 * mcp-multi-gmail - an MCP server giving an assistant access to several
 * separate Gmail mailboxes at once, through one connection.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

import { ConfigError, loadConfig, warnIfConfigNotIgnored } from './config.js';
import { buildInstructions } from './instructions.js';
import { bundledVersion } from './location.js';
import { registerDraftTools } from './tools/drafts.js';
import { registerFlagTools } from './tools/flags.js';
import { registerGetThread } from './tools/get-thread.js';
import { registerLabelTools } from './tools/labels.js';
import { registerListAccounts } from './tools/list-accounts.js';
import { registerNextPass } from './tools/next-pass.js';
import { registerReadMessageTools } from './tools/read-message.js';
import { registerSearchThreads } from './tools/search-threads.js';
import { registerSendMessage } from './tools/send-message.js';
import { registerTrashTools } from './tools/trash.js';

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

async function main(): Promise<void> {
  const configPath = resolveConfigPath(process.argv.slice(2));
  const config = await loadConfig(configPath);

  // Said before the server starts answering, so it is visible in the client's
  // log rather than buried after a run.
  const warning = await warnIfConfigNotIgnored(configPath);
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

  await server.connect(new StdioServerTransport());

  // stdout is the protocol channel, so every diagnostic goes to stderr.
  process.stderr.write(`${NAME} ${VERSION} běží, nastavených schránek: ${config.accounts.length}, přílohy do: ${config.downloadDir}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof ConfigError ? error.message : (error as Error)?.stack ?? String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
