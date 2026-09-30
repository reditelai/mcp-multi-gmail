// Tests of the waiting mode (src/watch.ts) against a fake mailbox. Run with
// `npm test` (builds first). Gmail is never touched.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { EXIT, parseDuration, parseHours, runWatch } from '../dist/watch.js';

const account = (name) => ({ name, address: `${name}@example.com` });

/** A fake clock and sleep: every sleep moves the clock by the interval. */
function harness({ checks, hours = null, maxRunMs = 60 * 60_000, start = new Date('2026-09-30T10:00:00') }) {
  let clock = start.getTime();
  const dir = mkdtempSync(join(tmpdir(), 'mg-watch-'));
  const lines = [];
  let calls = 0;
  const options = {
    intervalMs: 5 * 60_000,
    maxRunMs,
    problemAfterMs: 60 * 60_000,
    hours,
    claimPath: join(dir, 'wait.owner'),
    check: async (acc, since) => {
      calls += 1;
      return checks(acc, calls, since);
    },
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => new Date(clock),
  };
  return { options, lines, say: (line) => lines.push(line), calls: () => calls, dir };
}

test('new mail after the start wakes, what waited before does not', async () => {
  const h = harness({
    checks: (_acc, n) => (n < 3 ? new Set(['<old@x>']) : new Set(['<old@x>', '<new@x>'])),
  });
  const code = await runWatch([{ account: account('prace'), since: new Date('2026-09-30') }], h.options, h.say, new AbortController().signal);
  assert.equal(code, EXIT.mail);
  assert.match(h.lines[0], /nová pošta: prace 1/);
  assert.equal(existsSync(h.options.claimPath), false, 'claim removed on exit');
});

test('nothing new: ends before the background limit with "start again"', async () => {
  const h = harness({ checks: () => new Set(['<old@x>']), maxRunMs: 30 * 60_000 });
  const code = await runWatch([{ account: account('prace'), since: new Date('2026-09-30') }], h.options, h.say, new AbortController().signal);
  assert.equal(code, EXIT.restart);
  assert.match(h.lines[0], /vypršel čas/);
});

test('a rejected login is reported on the second check in a row', async () => {
  const auth = Object.assign(new Error('Invalid credentials'), { authenticationFailed: true });
  const h = harness({
    checks: (_acc, n) => {
      if (n === 1) return new Set();
      throw auth;
    },
  });
  const code = await runWatch([{ account: account('prace'), since: new Date('2026-09-30') }], h.options, h.say, new AbortController().signal);
  assert.equal(code, EXIT.problem);
  assert.match(h.lines[0], /prace se nepřihlásí/);
  assert.equal(h.calls(), 3);
});

test('a network hiccup is not a problem, and does not hide later mail', async () => {
  const h = harness({
    checks: (_acc, n) => {
      if (n === 2 || n === 3) throw new Error('getaddrinfo ENOTFOUND imap.gmail.com');
      return n < 4 ? new Set() : new Set(['<new@x>']);
    },
  });
  const code = await runWatch([{ account: account('prace'), since: new Date('2026-09-30') }], h.options, h.say, new AbortController().signal);
  assert.equal(code, EXIT.mail);
});

test('one mailbox with new mail is enough, the counts name the mailboxes', async () => {
  const h = harness({
    checks: (acc, n) => (acc.name === 'osobni' && n > 2 ? new Set(['<a@x>', '<b@x>']) : new Set()),
  });
  const code = await runWatch(
    [
      { account: account('prace'), since: new Date('2026-09-30') },
      { account: account('osobni'), since: new Date('2026-09-29') },
    ],
    h.options,
    h.say,
    new AbortController().signal,
  );
  assert.equal(code, EXIT.mail);
  assert.match(h.lines[0], /osobni 2/);
  assert.doesNotMatch(h.lines[0], /prace/);
});

test('outside the hours nothing is asked', async () => {
  const h = harness({ checks: () => new Set(), hours: [9, 19], start: new Date('2026-09-30T20:00:00'), maxRunMs: 60 * 60_000 });
  const code = await runWatch([{ account: account('prace'), since: new Date('2026-09-30') }], h.options, h.say, new AbortController().signal);
  assert.equal(code, EXIT.restart);
  assert.equal(h.calls(), 0);
});

test('a newer watcher takes over', async () => {
  const h = harness({
    checks: (_acc, n) => {
      if (n === 2) writeFileSync(h.options.claimPath, 'someone else');
      return new Set();
    },
  });
  const code = await runWatch([{ account: account('prace'), since: new Date('2026-09-30') }], h.options, h.say, new AbortController().signal);
  assert.equal(code, EXIT.replaced);
  assert.equal(readFileSync(h.options.claimPath, 'utf8'), 'someone else', 'the newer claim stays');
});

test('stopped from outside means start again', async () => {
  const controller = new AbortController();
  const h = harness({
    checks: (_acc, n) => {
      if (n === 2) controller.abort();
      return new Set();
    },
  });
  const code = await runWatch([{ account: account('prace'), since: new Date('2026-09-30') }], h.options, h.say, controller.signal);
  assert.equal(code, EXIT.restart);
  assert.match(h.lines[0], /zvenku/);
});

test('durations and hours', () => {
  assert.equal(parseDuration('5m'), 300_000);
  assert.equal(parseDuration('90s'), 90_000);
  assert.equal(parseDuration('2h'), 7_200_000);
  assert.equal(parseDuration('10'), 600_000);
  assert.equal(parseDuration('pět'), null);
  assert.deepEqual(parseHours('9-19'), [9, 19]);
  assert.deepEqual(parseHours('22-6'), [22, 6]);
  assert.equal(parseHours('9'), null);
});
