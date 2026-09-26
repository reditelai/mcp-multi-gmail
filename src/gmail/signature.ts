// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karel Derfl

/**
 * Signatures, and the aliases they belong to.
 *
 * A mailbox rarely has one signature. The same person writes as themselves, as
 * a company, and from an address that exists for one purpose, and each of those
 * ends differently. Which is why a signature is tied to an alias here rather
 * than to the mailbox: the address a message goes out from and the way it ends
 * are the same decision, and splitting them means picking the right address and
 * then signing it wrong.
 *
 * **A signature is written where text is written, not in JSON.** It is long,
 * it is full of quotes and tags, and it gets edited. Kept in its own file it
 * opens as a page; kept in the configuration it would have to be escaped every
 * time it changed.
 *
 * **Both forms are kept, and each side of a message gets its own.** A signature
 * with only plain text is converted for the HTML side rather than dropped,
 * because a message that ends with nothing looks like one that was cut off.
 */

import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { htmlToPlain } from './quote.js';

export interface Signature {
  /** How the signature is referred to when writing a message. */
  name: string;
  /** Plain text form, always present. */
  text: string;
  /** HTML form, or null when the signature is plain text only. */
  html: string | null;
}

export interface Alias {
  /** The address messages go out from. Must already be a verified alias in Gmail. */
  address: string;
  /** Display name for the From header, or null to send the address alone. */
  name: string | null;
  /**
   * What this alias is for, in the user's own words.
   *
   * Read by the assistant, never by Gmail. Without it an alias is an address
   * with no way of telling when it is the right one, and an assistant that
   * cannot tell will simply never use it.
   */
  purpose: string | null;
  /** Signature used for this alias unless the caller names another. */
  defaultSignature: string | null;
}

/** A signature as the configuration file writes it, before the files are read. */
export interface SignatureSource {
  text?: string | undefined;
  text_file?: string | undefined;
  html?: string | undefined;
  html_file?: string | undefined;
}

/**
 * Read one signature, resolving any file it points at.
 *
 * Relative paths are resolved against the configuration file, not against
 * wherever the server happened to be started from - the signatures belong to
 * the configuration and are normally kept beside it.
 */
export async function loadSignature(
  name: string,
  source: SignatureSource,
  configDir: string,
  problems: string[],
): Promise<Signature | null> {
  const before = problems.length;
  const text = await resolveField(name, 'text', source.text, source.text_file, configDir, problems);
  const html = await resolveField(name, 'html', source.html, source.html_file, configDir, problems);

  // An empty signature is the same as none, and a file that turned out empty is
  // a mistake worth hearing about rather than a message that quietly ends
  // nowhere.
  if ((text ?? '').trim() === '' && (html ?? '').trim() === '') {
    // Said only when nothing else about this signature was wrong. After "the
    // file cannot be read", adding that it also has no text is the same fault
    // told twice, and the second telling sounds like a different problem.
    if (problems.length === before) {
      problems.push(
        text === null && html === null
          ? `podpis "${name}" nemá ani text, ani HTML`
          : `podpis "${name}" je prázdný`,
      );
    }
    return null;
  }

  return {
    name,
    // A signature given as HTML alone still needs a plain form: the plain part
    // of the message is what a text-only client shows, and an unsigned message
    // there looks truncated.
    text: text ?? htmlToPlain(html ?? ''),
    html,
  };
}

async function resolveField(
  signature: string,
  field: 'text' | 'html',
  literal: string | undefined,
  file: string | undefined,
  configDir: string,
  problems: string[],
): Promise<string | null> {
  if (literal !== undefined && file !== undefined) {
    problems.push(`podpis "${signature}" má zároveň "${field}" i "${field}_file"; nech jen jedno z nich`);
    return null;
  }
  if (literal !== undefined) {
    return literal;
  }
  if (file === undefined) {
    return null;
  }

  const path = isAbsolute(file) ? file : resolve(configDir, file);
  try {
    // Trailing whitespace is trimmed: a file almost always ends with a newline,
    // and that newline would become a blank line between the signature and the
    // quote in every message.
    return (await readFile(path, 'utf8')).trimEnd();
  } catch {
    problems.push(`podpis "${signature}": soubor ${path} nejde přečíst`);
    return null;
  }
}

/**
 * Put the signature under the message being written, above any quote.
 *
 * Above the quote, because that is where a signature belongs: under the
 * history it would be lost at the bottom of a thread that grows with every
 * reply.
 */
export function appendSignature(
  body: string,
  htmlBody: string | undefined,
  signature: Signature | null,
): { body: string; htmlBody: string | undefined } {
  if (signature === null) {
    return { body, htmlBody };
  }
  return {
    body: `${body}\n\n${signature.text}`,
    htmlBody:
      htmlBody === undefined
        ? undefined
        : `${htmlBody}<div><br></div>${signature.html ?? textToHtml(signature.text)}`,
  };
}

function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r\n/g, '\n');
  return `<div dir="ltr">${escaped.split('\n').join('<br>')}</div>`;
}

