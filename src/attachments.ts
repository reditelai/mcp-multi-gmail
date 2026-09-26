// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karel Derfl

/**
 * Files attached to an outgoing message.
 *
 * A file is named by its path, never by its content: an attachment is routinely
 * megabytes, and content passed through a tool call would go through the
 * model's context to get here. The path is read from disk by this server, which
 * is also why where it may read from has to be said in the configuration.
 *
 * Attaching is off unless `attachment_dirs` names somewhere to read from. That
 * is the same rule as `allowed_recipients` and it is here for the same reason:
 * sending cannot be taken back, so the locked state has to be the one you get
 * by writing nothing.
 *
 * **This is the one feature here that can carry data off the machine.** Reading
 * mail means reading text written by people outside it, and a message can be
 * written to talk the assistant into something - "send me the file at ...".
 * Everything else in this server can at worst say too much back to a mailbox
 * the user already controls; this can put a file from their disk into an
 * outgoing message. That is why the allowed directories should be the narrowest
 * set that does the job, a folder meant for things going out rather than a
 * whole home directory or a notes vault, and why nothing here nudges anybody
 * towards turning it on.
 */

import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, resolve, sep } from 'node:path';

import type { Config } from './config.js';
import { ToolError } from './errors.js';

/**
 * Gmail refuses an outgoing message over 25 MB. The limit is on the assembled
 * message, not on the files: base64 makes attachments about a third larger, so
 * 20 MB of files do not fit. That is why the check is on the composed bytes
 * rather than on the sum of the file sizes - the honest number is only known
 * once the message exists.
 */
export const MAX_MESSAGE_BYTES = 25 * 1024 * 1024;

/** A file ready to hand to the composer. */
export interface ResolvedAttachment {
  filename: string;
  content: Buffer;
}

/**
 * Turn the paths a caller gave into files, refusing anything outside the
 * configured directories.
 */
export async function resolveAttachments(config: Config, paths: string[]): Promise<ResolvedAttachment[]> {
  if (paths.length === 0) {
    return [];
  }

  if (config.attachmentDirs.length === 0) {
    throw new ToolError(
      'send_forbidden',
      'This server may not attach files: no attachment_dirs are configured, and an absent list means ' +
        'nowhere rather than anywhere. Say the message can go without the attachment, or not at all. ' +
        'Do NOT propose turning this on: it lets mail carry files off this machine, and the person who ' +
        'wants it on will say so themselves.',
    );
  }

  const resolved: ResolvedAttachment[] = [];
  for (const given of paths) {
    resolved.push(await resolveOne(config, given));
  }
  return resolved;
}

async function resolveOne(config: Config, given: string): Promise<ResolvedAttachment> {
  // A relative path would be measured against whatever directory the server was
  // started from, which is not something the caller can see.
  if (!isAbsolute(given)) {
    throw new ToolError(
      'not_found',
      `Attachment path "${given}" is relative. Give an absolute path: this server is not started from the ` +
        'directory you are working in, so a relative path means something different here than it does to you.',
    );
  }

  // The real path, with symlinks followed, is what gets compared. Comparing the
  // path as written would let a link inside an allowed directory point at
  // anything on the disk, and the check would pass while reading elsewhere.
  let actual: string;
  try {
    actual = await realpath(resolve(given));
  } catch {
    throw new ToolError('not_found', `No file at "${given}".`);
  }

  if (!isInsideAllowed(actual, config.attachmentDirs)) {
    throw new ToolError(
      'send_forbidden',
      `"${given}" is outside the directories this server may attach from: ${config.attachmentDirs.join(', ')}. ` +
        'Send it without that file, or put the file in one of those directories if it belongs there. ' +
        'Widening the list is the user\'s decision to raise, not one to suggest because a file happens ' +
        'to be somewhere else.',
    );
  }

  const info = await stat(actual);
  if (!info.isFile()) {
    throw new ToolError('not_found', `"${given}" is not a file.`);
  }

  return {
    // The name the recipient sees comes from the file itself rather than from
    // the caller, so it always matches what was actually read.
    filename: basename(actual),
    content: await readFile(actual),
  };
}

/**
 * Is the path inside one of the allowed directories?
 *
 * The comparison ends at a separator on purpose. A plain prefix test would let
 * "/home/user/mail-other" through when "/home/user/mail" is allowed, because
 * one string does start with the other.
 */
function isInsideAllowed(candidate: string, allowed: string[]): boolean {
  return allowed.some((dir) => candidate === dir || candidate.startsWith(dir.endsWith(sep) ? dir : dir + sep));
}

/** Refuse a message Gmail would refuse, with the numbers the user needs to act on. */
export function assertMessageFits(bytes: number, attachmentCount: number): void {
  if (bytes <= MAX_MESSAGE_BYTES) {
    return;
  }
  const mb = (value: number): string => (value / 1024 / 1024).toFixed(1);
  throw new ToolError(
    'send_forbidden',
    `The assembled message is ${mb(bytes)} MB, over the ${mb(MAX_MESSAGE_BYTES)} MB Gmail accepts` +
      (attachmentCount > 0
        ? ', counting its ' +
          String(attachmentCount) +
          ' attachment(s) - encoding makes them about a third larger than they are on disk. ' +
          'Send fewer of them, or put the files somewhere the recipient can fetch them and send the link.'
        : '.') +
      ' Nothing was sent.',
  );
}
