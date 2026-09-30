// Tests of the watcher settings in config.json (src/config.ts).
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { loadConfig } from '../dist/config.js';

function write(body) {
  const path = join(mkdtempSync(join(tmpdir(), 'mg-config-')), 'config.json');
  writeFileSync(path, JSON.stringify(body), { mode: 0o600 });
  return path;
}
const mailbox = (name, extra = {}) => ({ name, address: `${name}@example.com`, password: 'abcdefghijklmnop', processed_label: 'M', ...extra });

test('watch is off by default and set per mailbox', async () => {
  const config = await loadConfig(write({ accounts: [mailbox('prace', { watch: true }), mailbox('faktury')] }));
  assert.deepEqual(config.accounts.map((a) => [a.name, a.watch]), [['prace', true], ['faktury', false]]);
  assert.equal(config.watchHours, null);
  assert.equal(config.watchIntervalMs, null);
});

test('watch hours and interval are read and checked', async () => {
  const config = await loadConfig(write({ accounts: [mailbox('prace')], watch_hours: '9-19', watch_interval: '10m' }));
  assert.deepEqual(config.watchHours, [9, 19]);
  assert.equal(config.watchIntervalMs, 600_000);
  await assert.rejects(loadConfig(write({ accounts: [mailbox('prace')], watch_hours: 'rano' })), /watch_hours/);
  await assert.rejects(loadConfig(write({ accounts: [mailbox('prace')], watch_interval: '10s' })), /watch_interval/);
});
