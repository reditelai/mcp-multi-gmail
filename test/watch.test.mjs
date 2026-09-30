// Tests of the waiting mode (src/watch.ts) against a fake mailbox. Run with
// `npm test` (builds first). Gmail is never touched.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { EXIT, parseDuration, parseHours, runWatch } from '../dist/watch.js';

const account = (name) => ({ name, address: `${name}@example.com` });
const prace = [{ account: account('prace'), since: new Date('2026-09-30') }];

/** A fake clock and sleep: every sleep moves the clock by the interval. */
function harness({ checks, hours = null, maxRunMs = 60 * 60_000, start = new Date('2026-09-30T10:00:00'), dir, known }) {
  let clock = start.getTime();
  dir = dir ?? mkdtempSync(join(tmpdir(), 'mg-watch-'));
  if (known !== undefined) {
    writeFileSync(join(dir, 'wait-known.json'), JSON.stringify({ version: 1, known }));
  }
  const lines = [];
  let calls = 0;
  const options = {
    intervalMs: 5 * 60_000,
    maxRunMs,
    hours,
    claimPath: join(dir, 'wait.owner'),
    statePath: join(dir, 'wait-known.json'),
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
const run = (h, watched = prace, signal = new AbortController().signal) => runWatch(watched, h.options, h.say, signal);

test('new mail wakes, mail it already told about does not', async () => {
  const h = harness({ known: { prace: ['<old@x>'] }, checks: (_a, n) => (n < 3 ? new Set(['<old@x>']) : new Set(['<old@x>', '<new@x>'])) });
  assert.equal(await run(h), EXIT.mail);
  assert.match(h.lines[0], /nová pošta: prace 1/);
});

test('without a state file, what waits wakes once; the next watcher stays quiet', async () => {
  const first = harness({ checks: () => new Set(['<a@x>']) });
  assert.equal(await run(first), EXIT.mail);
  const second = harness({ dir: first.dir, checks: () => new Set(['<a@x>']), maxRunMs: 20 * 60_000 });
  assert.equal(await run(second), EXIT.restart);
});

test('mail that came while no watcher ran wakes the next one at its first check', async () => {
  const first = harness({ known: { prace: [] }, checks: () => new Set(), maxRunMs: 10 * 60_000 });
  assert.equal(await run(first), EXIT.restart);
  const second = harness({ dir: first.dir, checks: () => new Set(['<gap@x>']) });
  assert.equal(await run(second), EXIT.mail);
  assert.equal(second.calls(), 1);
});

test('overnight mail wakes at the start of the hours', async () => {
  const h = harness({ known: { prace: [] }, hours: [9, 19], start: new Date('2026-09-30T08:00:00'), checks: () => new Set(['<night@x>']) });
  assert.equal(await run(h), EXIT.mail);
});

test('outside the hours nothing is asked', async () => {
  const h = harness({ checks: () => new Set(), hours: [9, 19], start: new Date('2026-09-30T20:00:00') });
  assert.equal(await run(h), EXIT.restart);
  assert.equal(h.calls(), 0);
});

test('a rejected login is reported on the second check in a row', async () => {
  const auth = Object.assign(new Error('Invalid credentials'), { authenticationFailed: true });
  const h = harness({ known: { prace: [] }, checks: () => { throw auth; } });
  assert.equal(await run(h), EXIT.problem);
  assert.match(h.lines[0], /prace se nepřihlásí/);
  assert.equal(h.calls(), 2);
});

test('one mailbox failing does not hold back mail in another', async () => {
  const auth = Object.assign(new Error('Invalid credentials'), { authenticationFailed: true });
  const h = harness({
    known: { prace: [], osobni: [] },
    checks: (acc, n) => {
      if (acc.name === 'osobni') throw auth;
      return n > 2 ? new Set(['<a@x>']) : new Set();
    },
  });
  const code = await run(h, [...prace, { account: account('osobni'), since: new Date('2026-09-30') }]);
  assert.equal(code, EXIT.mail);
  assert.match(h.lines[0], /prace 1/);
  assert.match(h.lines[0], /osobni se nepřihlásí/);
});

test('a long network outage never ends the watching with a problem', async () => {
  const h = harness({ known: { prace: [] }, maxRunMs: 110 * 60_000, checks: () => { throw new Error('getaddrinfo ENOTFOUND imap.gmail.com'); } });
  assert.equal(await run(h), EXIT.restart);
});

test('a network hiccup does not hide later mail', async () => {
  const h = harness({
    known: { prace: [] },
    checks: (_a, n) => {
      if (n === 1 || n === 2) throw new Error('ECONNRESET');
      return new Set(['<new@x>']);
    },
  });
  assert.equal(await run(h), EXIT.mail);
});

test('a replaced watcher stays replaced even after the newer one has finished', async () => {
  const h = harness({
    known: { prace: [] },
    checks: (_a, n) => {
      if (n === 2) writeFileSync(h.options.claimPath, 'newer watcher, already done');
      return new Set();
    },
  });
  assert.equal(await run(h), EXIT.replaced);
  assert.equal(readFileSync(h.options.claimPath, 'utf8'), 'newer watcher, already done');
});

test('stopped from outside means start again, without waiting out the interval', async () => {
  const controller = new AbortController();
  const h = harness({
    known: { prace: [] },
    checks: (_a, n) => {
      if (n === 2) controller.abort();
      return new Set();
    },
  });
  // The real sleep with a short interval: the stop comes during a check and
  // must end the watcher right away instead of after one more wait.
  h.options.sleep = undefined;
  h.options.intervalMs = 50;
  h.options.now = () => new Date();
  const startedAt = Date.now();
  const code = await runWatch(prace, h.options, h.say, controller.signal);
  assert.equal(code, EXIT.restart);
  assert.match(h.lines[0], /zvenku/);
  assert.ok(Date.now() - startedAt < 2_000);
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
