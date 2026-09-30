// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karel Derfl

/**
 * The waiting mode (--wait): a small process the assistant runs in the
 * background. It checks the mailboxes itself and ends as soon as mail arrives
 * that a pass would show as work, so an empty check costs no model tokens; the
 * end of the process is what wakes the conversation. It is the same design as
 * the watcher of mcp-whatsapp, with the same exit codes, so that an assistant
 * handles both the same way.
 *
 * Why: a pass started by a timer reads the whole conversation on every run,
 * even when nothing came - about 1.5 million tokens from cache per empty pass in
 * a long conversation (measured at Věrka, 27.-29. 9. 2026). Whether anything is
 * new is a question with a number for an answer and does not need a model.
 *
 * The check is the pass itself (pendingWork in ./gmail/pass.ts, the same scan
 * mg_next_pass runs). A separate query would drift from the pass one day, and
 * the watcher would then report nothing while a pass would find mail.
 *
 * It wakes only for mail that was not waiting when it started. Mail left
 * unprocessed from before would otherwise wake it again on every check.
 *
 * The one line it prints is read by the model; like the other messages a
 * person may read in a log, it is in Czech. It never names a sender or a
 * subject.
 */

import { readFile, rm, writeFile } from 'node:fs/promises';

import type { Account } from './config.js';
import { ToolError } from './errors.js';
import { describeFailure } from './gmail/connection.js';

/** Exit codes, the same as mcp-whatsapp; docs/pro-asistenta.md says what the assistant does with each. */
export const EXIT = {
  /** Mail to go through: run a pass. */
  mail: 0,
  /** A newer watcher took over, or the process that started this one is gone. */
  replaced: 3,
  /** Time is up or it was stopped from outside: start it again with the same boundaries. */
  restart: 4,
  /** Something the user has to fix (a revoked app password). Not restarted before it is fixed. */
  problem: 5,
  /** Started wrongly (config, boundary, mailbox name). */
  usage: 6,
} as const;

export interface Watched {
  account: Account;
  /** The mailbox's boundary, exactly what the pass gets as since. */
  since: Date;
}

export interface WatchOptions {
  /** How often the mailboxes are asked. */
  intervalMs: number;
  /**
   * The watcher ends before Claude Code stops its background process (at most
   * two hours), so that the end says "start again" instead of looking like a
   * stop.
   */
  maxRunMs: number;
  /** Hours of the day to check in, [from, to) in local time, or null for all day. */
  hours: [number, number] | null;
  /** A connection problem must last this long before it is reported. */
  problemAfterMs: number;
  /** A file the current watcher owns; an older one that sees another token ends. */
  claimPath: string;
  /** What a pass would show as work now. Injected so that the loop can be tested without Gmail. */
  check: (account: Account, since: Date) => Promise<Set<string>>;
  /** Waits between checks; resolves early when the signal aborts. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => Date;
}

export const DEFAULTS = {
  intervalMs: 5 * 60_000,
  maxRunMs: 115 * 60_000,
  problemAfterMs: 60 * 60_000,
};

/** Wait for new mail and return the exit code; the one line for the model goes to `say`. */
export async function runWatch(
  watched: Watched[],
  options: WatchOptions,
  say: (line: string) => void,
  signal: AbortSignal,
): Promise<number> {
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? defaultSleep;
  const again = 'Spusť hlídače znovu se stejnými kotvami.';
  const started = now().getTime();
  const parentPid = process.ppid;

  const token = `${process.pid} ${started} ${Math.random().toString(36).slice(2)}`;
  try {
    await writeFile(options.claimPath, token, { mode: 0o600 });
  } catch (error) {
    say(`chyba: nejde zapsat ${options.claimPath}: ${String(error)}`);
    return EXIT.usage;
  }

  const baseline = new Map<string, Set<string>>();
  const failingSince = new Map<string, number>();
  const authFailures = new Map<string, number>();

  try {
    for (;;) {
      if (signal.aborted) {
        say(`konec: hlídač byl zastaven zvenku. ${again}`);
        return EXIT.restart;
      }
      if (!(await ownsClaim(options.claimPath, token))) {
        say('konec: hlídání převzal novější hlídač');
        return EXIT.replaced;
      }
      // Windows keeps a dead parent's PID, so the check would only misfire there.
      if (process.platform !== 'win32' && parentPid !== 1 && process.ppid !== parentPid) {
        say('konec: proces, který hlídače spustil, skončil');
        return EXIT.replaced;
      }

      const at = now();
      if (inHours(at, options.hours)) {
        const fresh: string[] = [];
        for (const { account, since } of watched) {
          let keys: Set<string>;
          try {
            keys = await options.check(account, since);
          } catch (error) {
            const problem = judgeFailure(account, error, at.getTime(), failingSince, authFailures, options.problemAfterMs);
            if (problem !== null) {
              say(`problém: ${problem}`);
              return EXIT.problem;
            }
            continue;
          }
          failingSince.delete(account.name);
          authFailures.delete(account.name);

          const known = baseline.get(account.name);
          if (known === undefined) {
            // First answer from this mailbox: what waits now is not news.
            baseline.set(account.name, keys);
            continue;
          }
          let count = 0;
          for (const key of keys) {
            if (!known.has(key)) {
              count += 1;
            }
          }
          if (count > 0) {
            fresh.push(`${account.name} ${count}`);
          }
        }
        if (fresh.length > 0) {
          say(`nová pošta: ${fresh.join(', ')}. Projdi ji průchodem (mg_next_pass) s kotvami, se kterými jsi hlídače spustila.`);
          return EXIT.mail;
        }
      }

      if (now().getTime() - started >= options.maxRunMs) {
        say(`konec: vypršel čas hlídání. ${again}`);
        return EXIT.restart;
      }
      await sleep(options.intervalMs, signal);
    }
  } finally {
    if (await ownsClaim(options.claimPath, token)) {
      await rm(options.claimPath, { force: true }).catch(() => undefined);
    }
  }
}

/**
 * What a failed check means. A rejected login is the user's to fix (a revoked
 * or changed app password) and is reported on the second check in a row; a
 * mailbox the server cannot work with is reported at once; anything else
 * (network, Gmail having a moment) only when it lasts, because a laptop that
 * lost Wi-Fi would otherwise wake the assistant for nothing.
 */
function judgeFailure(
  account: Account,
  error: unknown,
  at: number,
  failingSince: Map<string, number>,
  authFailures: Map<string, number>,
  problemAfterMs: number,
): string | null {
  const code = error instanceof ToolError ? error.code : describeFailure(error).code;
  const detail = error instanceof Error ? error.message : String(error);
  if (code === 'auth_failed') {
    const count = (authFailures.get(account.name) ?? 0) + 1;
    authFailures.set(account.name, count);
    return count >= 2
      ? `schránka ${account.name} se nepřihlásí, heslo aplikace je nejspíš zrušené nebo změněné (${detail})`
      : null;
  }
  if (code === 'provider_unsupported' || code === 'query_too_broad') {
    return `schránka ${account.name}: ${detail}`;
  }
  const since = failingSince.get(account.name) ?? at;
  failingSince.set(account.name, since);
  return at - since >= problemAfterMs ? `schránka ${account.name} už dlouho neodpovídá (${detail})` : null;
}

function inHours(at: Date, hours: [number, number] | null): boolean {
  if (hours === null) {
    return true;
  }
  const hour = at.getHours();
  const [from, to] = hours;
  return from <= to ? hour >= from && hour < to : hour >= from || hour < to;
}

async function ownsClaim(path: string, token: string): Promise<boolean> {
  try {
    return (await readFile(path, 'utf8')) === token;
  } catch {
    // Removed by hand: nobody newer claimed it, so keep watching.
    return true;
  }
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done);
  });
}

/** "5m", "90s", "2h" or a number of minutes, in milliseconds; null when it cannot be read. */
export function parseDuration(text: string): number | null {
  const match = /^(\d+(?:\.\d+)?)\s*(s|m|h)?$/.exec(text.trim());
  if (match === null || match[1] === undefined) {
    return null;
  }
  const value = Number(match[1]);
  const unit = match[2] ?? 'm';
  return Math.round(value * (unit === 's' ? 1_000 : unit === 'h' ? 3_600_000 : 60_000));
}

/** "9-19" as [9, 19]; null when it cannot be read. */
export function parseHours(text: string): [number, number] | null {
  const match = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(text.trim());
  if (match === null || match[1] === undefined || match[2] === undefined) {
    return null;
  }
  const from = Number(match[1]);
  const to = Number(match[2]);
  return from <= 24 && to <= 24 && from !== to ? [from, to] : null;
}
