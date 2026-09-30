// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karel Derfl

/** Durations and hour ranges of the mail watcher, read from config.json and from the command line. */

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
