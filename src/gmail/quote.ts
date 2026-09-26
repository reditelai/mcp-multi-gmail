// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karel Derfl

/**
 * Quoting the message a reply answers.
 *
 * Nothing in the mail protocols quotes anything. The indented history under a
 * reply is written by the client that composed it: Gmail builds it in the
 * browser when the user hits Reply, and by the time the message reaches SMTP
 * the quote is ordinary body text like any other. A server that composes a
 * message itself therefore sends a reply with no history at all unless it
 * writes one, and the recipient sees a bare sentence with nothing above it.
 *
 * That is worst where it is least expected. A reply can be read against what
 * the reader wrote themselves, but a message passed on to somebody new - which
 * over IMAP and SMTP is a reply with the recipient changed, there being no
 * forward operation - reaches a person who has never seen the thread.
 *
 * **Only the message being answered is quoted.** It already carries its own
 * quoted history, so the chain builds up on its own, exactly as it does in
 * every mail client. Whether that history is complete is another matter: a
 * mobile client may have cut it off before it ever arrived. What is passed on
 * is what came in, which is also all Gmail does.
 *
 * **Both sides are built from their own source.** The plain side is quoted
 * from the original's plain part and the HTML side from its HTML part, because
 * escaping plain text into the HTML side would show the original's author their
 * own formatting stripped.
 *
 * **Inline images do not survive.** They are attachments referenced by cid:
 * from the HTML, and the attachments are not carried over, so those references
 * point at nothing. Gmail has the whole message on its own servers and can keep
 * them; this cannot, and a broken image is the honest outcome rather than a
 * silent rewrite of somebody else's message.
 */

import type { FetchMessageObject, ImapFlow } from 'imapflow';

import { downloadText, findBodyParts } from './body.js';

/** Languages the attribution line is written in. Anything else falls back to English. */
export type QuoteLocale = 'cs' | 'en';

export interface Quote {
  /** The quote for the plain text side, every line prefixed with "> ". */
  text: string;
  /** The quote for the HTML side, in the shape Gmail uses. */
  html: string;
}

interface QuoteSource {
  /** Display name of the author, empty when the message carried none. */
  name: string;
  address: string;
  /** When the message was written. The header date, which is what a reader recognises. */
  date: Date | null;
}

/**
 * Build the quote of one already-fetched message, or null when there is
 * nothing to quote.
 *
 * The message is passed in rather than looked up, because both callers have
 * already found it - a draft to check the thread it joins, a send to know what
 * it is answering - and fetching it twice would be a second round trip for
 * bytes that are already here. It must have been fetched with `uid`,
 * `envelope` and `bodyStructure`, and the folder it is in must be open, since
 * the body parts are downloaded from it.
 *
 * Null rather than an empty string, so the caller appends nothing at all
 * instead of a stray attribution line over a blank quote.
 */
export async function buildQuote(
  client: ImapFlow,
  message: FetchMessageObject,
  locale: QuoteLocale,
): Promise<Quote | null> {
  const structure = message.bodyStructure;
  if (structure === undefined) {
    return null;
  }

  const author = message.envelope?.from?.[0];
  const source: QuoteSource = {
    name: author?.name ?? '',
    address: author?.address ?? '',
    date: message.envelope?.date ?? null,
  };

  const parts = findBodyParts(structure);
  if (parts.text === null && parts.html === null) {
    return null;
  }

  const originalText = parts.text === null ? null : await downloadText(client, message.uid, parts.text);
  const originalHtml = parts.html === null ? null : await downloadText(client, message.uid, parts.html);

  // Neither part held anything. A message can have an empty body - one sent
  // with only an attachment, for instance - and quoting it would produce an
  // attribution line standing over nothing.
  if ((originalText ?? '').trim() === '' && (originalHtml ?? '').trim() === '') {
    return null;
  }

  const attribution = attributionLine(source, locale);

  // Each side falls back to the other when its own part is missing, because a
  // message with only one of the two is common and a missing quote is worse
  // than one converted across.
  const plainSource = originalText ?? htmlToPlain(originalHtml ?? '');
  const htmlSource = originalHtml ?? plainToHtml(originalText ?? '');

  return {
    text: `${attribution}\n${prefixLines(plainSource)}`,
    html: quotedHtml(attribution, source.address, htmlSource),
  };
}

/**
 * Put the quote under the message being written.
 *
 * The HTML side is only touched when the caller wrote one. A message with a
 * plain body alone stays plain: inventing an HTML part to carry the quote
 * would change what the message is, and the quote is already in the plain
 * text where such a message is read.
 */
export function appendQuote(
  body: string,
  htmlBody: string | undefined,
  quote: Quote | null,
): { body: string; htmlBody: string | undefined } {
  if (quote === null) {
    return { body, htmlBody };
  }
  return {
    body: `${body}\n\n${quote.text}`,
    htmlBody: htmlBody === undefined ? undefined : `${htmlBody}${quote.html}`,
  };
}

/**
 * The line above the quote, in the wording the reader's own client would use.
 *
 * Written out per language rather than assembled from fragments: the word
 * order differs, and a sentence built from pieces reads like one built from
 * pieces in whichever language was not thought about.
 */
function attributionLine(source: QuoteSource, locale: QuoteLocale): string {
  const author = source.name.trim() === '' ? source.address : `${source.name} <${source.address}>`;

  if (source.date === null) {
    return locale === 'cs' ? `Odesílatel ${author} napsal:` : `${author} wrote:`;
  }

  if (locale === 'cs') {
    const day = new Intl.DateTimeFormat('cs-CZ', {
      weekday: 'short',
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
    }).format(source.date);
    const time = new Intl.DateTimeFormat('cs-CZ', { hour: 'numeric', minute: '2-digit' }).format(source.date);
    return `Dne ${day} v ${time} odesílatel ${author} napsal:`;
  }

  const day = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(source.date);
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(
    source.date,
  );
  return `On ${day} at ${time} ${author} wrote:`;
}

/** Every line prefixed the way plain text quoting has been done since before HTML mail. */
function prefixLines(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n');
}

const QUOTE_STYLE = 'margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex';

/**
 * The quote for the HTML side, in the markup Gmail produces.
 *
 * The class names are Gmail's own and are kept deliberately: clients collapse a
 * quote behind a "show trimmed content" control by recognising them, so markup
 * that only looks the same would show the whole history expanded.
 */
function quotedHtml(attribution: string, address: string, originalHtml: string): string {
  const escaped = escapeHtml(attribution);
  // The replacement is given as a function, not as a string. In a string, "$&"
  // and "$'" mean something to replace(), and an e-mail address may legally
  // contain a dollar - which would then splice parts of the line into itself.
  const linkedAuthor =
    address === ''
      ? escaped
      : escaped.replace(
          escapeHtml(`<${address}>`),
          () => `&lt;<a href="mailto:${escapeHtml(encodeURI(address))}">${escapeHtml(address)}</a>&gt;`,
        );

  return [
    '<div class="gmail_quote">',
    `<div dir="ltr" class="gmail_attr">${linkedAuthor}<br></div>`,
    `<blockquote class="gmail_quote" style="${QUOTE_STYLE}">`,
    insideBody(originalHtml),
    '</blockquote>',
    '</div>',
  ].join('');
}

/**
 * The contents of an HTML message, without the document around it.
 *
 * A full document nested inside a blockquote is not valid HTML, and what a
 * client does with the second <html> in a message is its own business. Only the
 * wrapper is dropped; the markup inside is passed on as it arrived, because it
 * is somebody else's message and rewriting it would change what they said.
 */
function insideBody(html: string): string {
  const opening = /<body\b[^>]*>/i.exec(html);
  if (opening === null) {
    return html;
  }
  const start = opening.index + opening[0].length;

  // Found with a case-insensitive search rather than by lowercasing the text
  // first: lowercasing is not length-preserving in every language - a Turkish
  // dotted I becomes two characters - and an index taken from the lowercased
  // copy would then cut the original in the wrong place.
  const closings = [...html.matchAll(/<\/body\s*>/gi)];
  const last = closings[closings.length - 1];
  const closing = last === undefined ? -1 : last.index;

  return closing > start ? html.slice(start, closing) : html.slice(start);
}

/** Plain text as HTML, for a message that had no HTML part of its own. */
function plainToHtml(text: string): string {
  return escapeHtml(text.replace(/\r\n/g, '\n')).split('\n').join('<br>');
}

/**
 * The HTML half of a message whose author wrote only plain text.
 *
 * A message sent as text alone is a message whose signature loses its logo,
 * whose quote loses its indent, and which looks different from everything else
 * the mailbox sends - because a mail client always sends both halves. Writing
 * only the text is the normal case, so the HTML is built here rather than
 * demanded from the caller.
 *
 * Shaped the way Gmail shapes it: an outer div, one div per line, an empty
 * line as a div holding a break. A reply quoting this then looks the same as a
 * reply quoting something written in Gmail.
 */
export function plainBodyToHtml(text: string): string {
  const escaped = text
    .replace(/\r\n/g, '\n')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const lines = escaped.split('\n').map((line) => (line === '' ? '<div><br></div>' : `<div>${line}</div>`));
  return `<div dir="ltr">${lines.join('')}</div>`;
}

/**
 * HTML as plain text, for a message or a signature that had no plain part.
 *
 * Crude on purpose: this is the fallback side, not a rendering engine.
 * Block-level tags become line breaks, everything else is dropped, and the
 * reader still has the HTML side to look at.
 */
export function htmlToPlain(html: string): string {
  return insideBody(html)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
