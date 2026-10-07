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

import { statSync } from 'node:fs';
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
 * The root of Miládka's folder when the server runs from her add-on folder
 * (`<vault>/.doplnky/mcp-multi-gmail/`), else null. Relative paths in the
 * configuration that point into her folder - the passwords file - are taken
 * from here, so they do not depend on where the process was started.
 */
export function vaultRoot(): string | null {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const addons = dirname(here);
    return ADDON_DIRS[basename(addons)] ? dirname(addons) : null;
  } catch {
    return null;
  }
}

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

/**
 * Why the server will not run here, or null when it may. The add-on belongs to
 * Miládka and runs only from her add-on folder, in a folder that has
 * `.miladka/VERSION` (Karel, 8. 10. 2026). A build from source, not bundled,
 * runs anywhere, for development.
 */
export function outsideMiladka(
  serverFile: string = fileURLToPath(import.meta.url),
  bundled: boolean = bundledVersion() !== null,
): string | null {
  if (!bundled) return null;
  const addons = dirname(dirname(serverFile));
  if (ADDON_DIRS[basename(addons)] === undefined) {
    return `program neleží ve složce doplňků Miládky (.doplnky/mcp-multi-gmail/), ale v ${dirname(serverFile)}`;
  }
  const version = join(dirname(addons), '.miladka', 'VERSION');
  try {
    if (statSync(version).isFile()) return null;
  } catch {
    // reported below
  }
  return `ve složce ${dirname(addons)} chybí .miladka/VERSION, není to složka Miládky`;
}

/**
 * What the server says when it will not start outside Miládka, the same for
 * every reason: a person outside Miládka needs Miládka, not a path (Karel,
 * 8. 10. 2026). Inside Miládka the assistant finds the cause from .mcp.json.
 */
export function miladkaRequired(): string {
  return (
    'mcp-multi-gmail je doplněk Miládky a funguje jen v ní. Pořiďte si Miládku na https://miladka.cz a doplněk si nainstalujte v ní.\n' +
    'mcp-multi-gmail is an add-on for Miládka and works only inside her. Get Miládka at https://miladka.cz and install the add-on there.'
  );
}
