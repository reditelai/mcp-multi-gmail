// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karel Derfl

/**
 * Where the server runs from, and what that says about the defaults.
 *
 * Released as one bundled file (mcp-multi-gmail.mjs). In Miládka it lives in
 * her add-on folder, `<vault>/.doplnky/mcp-multi-gmail/` (`.addons` in the
 * English package), so that everything of hers stays in one folder that the
 * user moves and backs up as a whole (Karel, 29. 9. 2026).
 */

import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Set by the bundler (npm run bundle); undefined when run from dist/. */
declare const __MG_VERSION__: string | undefined;

/** Version of the bundled file, or null when running from a clone. */
export function bundledVersion(): string | null {
  return typeof __MG_VERSION__ === 'string' ? __MG_VERSION__ : null;
}

const ADDON_DIRS: Record<string, { inbox: string; attachments: string }> = {
  '.doplnky': { inbox: 'vstupy', attachments: 'prilohy' },
  '.addons': { inbox: 'inbox', attachments: 'attachments' },
};

/**
 * Default attachment folder inside Miládka: `vstupy/prilohy` in her folder
 * (`inbox/attachments` in English), next to `vstupy/whatsapp` of the
 * WhatsApp add-on. Null outside the add-on folder.
 */
export function vaultAttachmentDir(): string | null {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const addons = dirname(here);
    const names = ADDON_DIRS[basename(addons)];
    return names ? join(dirname(addons), names.inbox, names.attachments) : null;
  } catch {
    return null;
  }
}
