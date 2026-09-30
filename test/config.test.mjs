// Tests of config.json (src/config.ts): the watcher settings and the passwords file.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { loadConfig, warnIfSecretsNotIgnored } from '../dist/config.js';

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

// Settings without passwords, next to a passwords file as Miládka keeps them.
function withPasswords(passwords, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mg-secrets-'));
  const noPassword = (name) => ({ name, address: `${name}@example.com`, processed_label: 'M' });
  const config = join(dir, 'multigmail.json');
  writeFileSync(config, JSON.stringify({ accounts: [noPassword('prace'), noPassword('faktury')], passwords_file: 'hesla.json', ...extra }));
  if (passwords !== undefined) {
    writeFileSync(join(dir, 'hesla.json'), typeof passwords === 'string' ? passwords : JSON.stringify(passwords), { mode: 0o600 });
  }
  return { dir, config };
}

test('passwords come from passwords_file, relative to the settings outside Miládka', async () => {
  const { dir, config } = withPasswords({ prace: 'abcd efgh ijkl mnop', faktury: 'qrstuvwxyzabcdef' });
  const loaded = await loadConfig(config);
  assert.deepEqual(loaded.accounts.map((a) => a.password), ['abcdefghijklmnop', 'qrstuvwxyzabcdef']);
  // Only the passwords file holds a secret; the settings are meant for the backup.
  assert.deepEqual(loaded.secretFiles, [join(dir, 'hesla.json')]);
});

test('a password in the settings wins over the file and makes them secret', async () => {
  const { dir } = withPasswords({ faktury: 'qrstuvwxyzabcdef' });
  const config = join(dir, 'multigmail.json');
  writeFileSync(config, JSON.stringify({ accounts: [mailbox('prace'), { name: 'faktury', address: 'f@example.com', processed_label: 'M' }], passwords_file: 'hesla.json' }));
  const loaded = await loadConfig(config);
  assert.deepEqual(loaded.accounts.map((a) => a.password), ['abcdefghijklmnop', 'qrstuvwxyzabcdef']);
  assert.deepEqual(loaded.secretFiles, [join(dir, 'hesla.json'), config]);
});

test('passwords file problems name the file and never its content', async () => {
  await assert.rejects(loadConfig(withPasswords(undefined).config), /soubor s hesly .*hesla\.json nejde přečíst/);
  const broken = loadConfig(withPasswords('{"prace": "tajneheslotajneh",').config);
  await assert.rejects(broken, (error) => /není platný JSON/.test(error.message) && !error.message.includes('tajne'));
  await assert.rejects(loadConfig(withPasswords({ prace: 'abcdefghijklmnop' }).config), /faktury nemá heslo v souboru s hesly/);
});

test('a password not pasted in yet warns and leaves the other mailboxes working', async () => {
  const loaded = await loadConfig(withPasswords({ prace: 'SEM_VLOZ_HESLO_APLIKACE', faktury: 'qrstuvwxyzabcdef' }).config);
  assert.deepEqual(loaded.accounts.map((a) => a.name), ['prace', 'faktury']);
  assert.equal(loaded.warnings.length, 1);
  assert.match(loaded.warnings[0], /^prace: heslo ještě není vložené/);
  const inline = await loadConfig(write({ accounts: [mailbox('prace', { password: 'SEM_VLOZ_HESLO_APLIKACE' })] }));
  assert.match(inline.warnings[0], /^prace: heslo ještě není vložené/);
  assert.deepEqual((await loadConfig(withPasswords({ prace: 'abcdefghijklmnop', faktury: 'qrstuvwxyzabcdef' }).config)).warnings, []);
});

test('a mailbox named like an object property is looked up in the file only', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mg-secrets-'));
  const config = join(dir, 'multigmail.json');
  writeFileSync(config, JSON.stringify({ accounts: [{ name: 'constructor', address: 'c@example.com', processed_label: 'M' }], passwords_file: 'hesla.json' }));
  writeFileSync(join(dir, 'hesla.json'), '{}');
  await assert.rejects(loadConfig(config), /constructor nemá heslo v souboru s hesly/);
});

test('settings saved with a byte order mark load', async () => {
  const path = write({ accounts: [mailbox('prace')] });
  writeFileSync(path, '\uFEFF' + JSON.stringify({ accounts: [mailbox('prace')] }));
  assert.equal((await loadConfig(path)).accounts.length, 1);
});

test('no password anywhere names all three ways', async () => {
  const path = write({ accounts: [{ name: 'prace', address: 'p@example.com', processed_label: 'M' }] });
  await assert.rejects(loadConfig(path), /nemá ani "password", ani "password_env", ani heslo v "passwords_file"/);
});

test('a passwords file in git is flagged until it is ignored', async () => {
  const { dir } = withPasswords({});
  const secret = join(dir, 'hesla.json');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  assert.match(await warnIfSecretsNotIgnored([secret]), /hesla\.json leží v gitovém repozitáři/);
  writeFileSync(join(dir, '.gitignore'), 'hesla.json\n');
  assert.equal(await warnIfSecretsNotIgnored([secret]), null);
  assert.equal(await warnIfSecretsNotIgnored([join(tmpdir(), 'mimo-repo-neexistuje', 'hesla.json')]), null);
});
