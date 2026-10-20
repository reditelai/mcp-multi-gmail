// Tests of storing a message as read (src/gmail/append.ts) against a fake
// IMAP client. Run with `npm test` (builds first). Gmail is never touched.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { appendAsRead } from '../dist/gmail/append.js';

/** A fake client. `keepsFlags: false` drops the flags on APPEND, as imapflow does after a read-only folder. */
function fakeClient({ keepsFlags = true, acceptsStore = true, reportsUid = true, refuses = false } = {}) {
  const flags = new Set();
  const calls = [];
  return {
    calls,
    async getMailboxLock(path, options) {
      calls.push(['lock', path, options?.readOnly === true ? 'read-only' : 'write']);
      return { release: () => calls.push(['release']) };
    },
    async append(path, raw, wanted) {
      calls.push(['append', path]);
      if (refuses) return false;
      if (keepsFlags) wanted.forEach((flag) => flags.add(flag));
      return reportsUid ? { uid: 81579 } : {};
    },
    async fetchOne(uid) {
      return { uid: Number(uid), flags: new Set(flags) };
    },
    async messageFlagsAdd(uid, added) {
      calls.push(['store', uid, ...added]);
      if (acceptsStore) added.forEach((flag) => flags.add(flag));
      return acceptsStore;
    },
  };
}

const raw = Buffer.from('Subject: test\r\n\r\nbody');

test('the destination is opened for writing, so the flag is not dropped', async () => {
  const client = fakeClient();
  assert.deepEqual(await appendAsRead(client, '[Gmail]/Koncepty', raw), { uid: 81579, seen: true });
  assert.deepEqual(client.calls[0], ['lock', '[Gmail]/Koncepty', 'write']);
  assert.ok(!client.calls.some(([name]) => name === 'store'), 'no extra STORE when the flag held');
  assert.deepEqual(client.calls.at(-1), ['release']);
});

test('a flag dropped on APPEND is set again', async () => {
  const client = fakeClient({ keepsFlags: false });
  assert.deepEqual(await appendAsRead(client, '[Gmail]/Koncepty', raw), { uid: 81579, seen: true });
  assert.ok(client.calls.some(([name, , flag]) => name === 'store' && flag === '\\Seen'));
});

test('a flag Gmail will not keep is reported, not assumed', async () => {
  const client = fakeClient({ keepsFlags: false, acceptsStore: false });
  assert.deepEqual(await appendAsRead(client, '[Gmail]/Koncepty', raw), { uid: 81579, seen: false });
});

test('without a UID there is nothing to read back', async () => {
  assert.deepEqual(await appendAsRead(fakeClient({ reportsUid: false }), 'x', raw), { uid: null, seen: null });
});

test('a refused message is false and the lock is released', async () => {
  const client = fakeClient({ refuses: true });
  assert.equal(await appendAsRead(client, 'x', raw), false);
  assert.deepEqual(client.calls.at(-1), ['release']);
});
