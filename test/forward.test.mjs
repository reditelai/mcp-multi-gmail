// Tests of forwarding (src/gmail/forward.ts) against a fake IMAP client.
// Run with `npm test` (builds first). Gmail is never touched.
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';

import { forwardSubject, readForwarded } from '../dist/gmail/forward.js';

const structure = {
  type: 'multipart/mixed',
  childNodes: [
    {
      type: 'multipart/related',
      childNodes: [
        {
          type: 'multipart/alternative',
          childNodes: [
            { part: '1.1.1', type: 'text/plain', parameters: { charset: 'utf-8' } },
            { part: '1.1.2', type: 'text/html', parameters: { charset: 'utf-8' } },
          ],
        },
        { part: '1.2', type: 'image/png', disposition: 'inline', id: '<logo@x>', dispositionParameters: { filename: 'logo.png' } },
      ],
    },
    { part: '2', type: 'application/pdf', disposition: 'attachment', dispositionParameters: { filename: 'faktura.pdf' } },
    // Gmail sends an image pasted into the text as an attachment the HTML points at.
    { part: '3', type: 'image/png', disposition: 'attachment', id: '<ii_abc>', dispositionParameters: { filename: 'image.png' } },
    // A Content-ID nothing in the HTML refers to stays an ordinary attachment.
    { part: '4', type: 'image/jpeg', disposition: 'attachment', id: '<unused>', dispositionParameters: { filename: 'foto.jpg' } },
  ],
};

const parts = {
  '1.1.1': ['text/plain', null, 'Dobrý den,\nposílám fakturu.'],
  '1.1.2': ['text/html', null, '<html><body><div>Dobrý den,<br>posílám fakturu.</div><img src="cid:logo@x"><img src="cid:ii_abc"></body></html>'],
  '1.2': ['image/png', 'logo.png', 'PNG'],
  '2': ['application/pdf', 'faktura.pdf', 'PDF'],
  '3': ['image/png', 'image.png', 'IMG'],
  '4': ['image/jpeg', 'foto.jpg', 'JPG'],
};

const client = {
  async download(uid, part) {
    const [contentType, filename, body] = parts[part];
    return { meta: { contentType, filename, charset: 'utf-8' }, content: Readable.from([Buffer.from(body)]) };
  },
};

const original = {
  uid: 7,
  threadId: '42',
  bodyStructure: structure,
  envelope: {
    subject: 'Faktura za říjen',
    date: new Date('2026-10-20T10:00:00Z'),
    from: [{ name: 'Jana Nová', address: 'jana@example.com' }],
    to: [{ name: '', address: 'karel@example.com' }],
  },
};

test('the original goes under the new text with its headers, in Czech', async () => {
  const forwarded = await readForwarded(client, original, true, 'cs');
  assert.match(forwarded.block.text, /^---------- Přeposlaná zpráva ---------\nOd: Jana Nová <jana@example.com>\nDatum: .+\nPředmět: Faktura za říjen\nKomu: karel@example.com\n\nDobrý den,\nposílám fakturu\.$/);
  assert.ok(forwarded.block.html.startsWith('<br><div class="gmail_quote">'), 'a blank line above the header block');
  assert.match(forwarded.block.html, /class="gmail_quote".*Od: Jana Nová &lt;jana@example.com&gt;.*<div>Dobrý den,<br>posílám fakturu\.<\/div><img src="cid:logo@x"><img src="cid:ii_abc">/s);
  assert.ok(!forwarded.block.html.includes('<body>'), 'the document wrapper is dropped');
  assert.equal(forwarded.subject, 'Fwd: Faktura za říjen');
  assert.equal(forwarded.threadId, '42');
});

test('all attachments come along, images the HTML shows with their Content-ID', async () => {
  const { attachments } = await readForwarded(client, original, true, 'en');
  assert.deepEqual(
    attachments.map((file) => [file.filename, file.contentType, file.cid ?? null, file.content.toString()]),
    [
      ['logo.png', 'image/png', 'logo@x', 'PNG'],
      ['faktura.pdf', 'application/pdf', null, 'PDF'],
      ['image.png', 'image/png', 'ii_abc', 'IMG'],
      ['foto.jpg', 'image/jpeg', null, 'JPG'],
    ],
  );
});

test('attachments can be left out or picked by id', async () => {
  assert.deepEqual((await readForwarded(client, original, false, 'cs')).attachments, []);
  const picked = await readForwarded(client, original, ['2'], 'cs');
  assert.deepEqual(picked.attachments.map((file) => file.filename), ['faktura.pdf']);
});

test('an attachment id the message does not have is refused, with the ones it has', async () => {
  await assert.rejects(readForwarded(client, original, ['9'], 'cs'), /no attachment 9.*2 \(faktura\.pdf\)/);
});

test('a subject that already says forward is left alone', () => {
  assert.equal(forwardSubject('Fwd: Faktura'), 'Fwd: Faktura');
  assert.equal(forwardSubject('PŘ: Faktura'), 'PŘ: Faktura');
  assert.equal(forwardSubject('Re: Faktura'), 'Fwd: Re: Faktura');
});
