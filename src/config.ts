// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karel Derfl

/**
 * Configuration loading.
 *
 * Mailboxes are addressed by a short name everywhere in the tool interface.
 * E-mail addresses live in the configuration file and never in the code, so
 * the code can be handed to somebody else without carrying anybody's
 * addresses with it.
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import * as z from 'zod';

import { parseDuration, parseHours } from './duration.js';
import { vaultAttachmentDir, vaultRoot } from './location.js';
import type { QuoteLocale } from './gmail/quote.js';
import { loadSignature, type Alias, type Signature } from './gmail/signature.js';

/**
 * A signature, written either in the file or in a file beside it.
 *
 * Unknown keys are refused here too: a misspelt `html_file` would leave the
 * signature plain text only, and a plain signature where an HTML one was meant
 * looks like a formatting fault rather than a configuration one.
 */
const signatureSchema = z.strictObject({
  text: z.string().optional().describe('Plain text of the signature'),
  text_file: z.string().min(1).optional().describe('File holding the plain text, relative to the configuration file'),
  html: z.string().optional().describe('HTML of the signature'),
  html_file: z.string().min(1).optional().describe('File holding the HTML, relative to the configuration file'),
});

const aliasSchema = z.strictObject({
  address: z.email('musí být e-mailová adresa').describe('Address to send from; must be a verified Gmail alias'),
  name: z.string().min(1).optional().describe('Display name for the From header'),
  // Read by the assistant when it decides which address fits, never by Gmail.
  purpose: z.string().min(1).optional().describe('What this alias is for, so the assistant knows when to use it'),
  default_signature: z.string().min(1).optional().describe('Signature used for this alias unless another is named'),
});

const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const DEFAULT_PROCESSED_LABEL = 'processed';

/**
 * The labels the assistant may put on a conversation, each one written out in
 * full and paired with what it means.
 *
 * The meaning is not decoration: it is what the assistant reads when it decides
 * which one fits, so "Assistant/urgent" can be described as "urgent, today" and needs no
 * translation anywhere in the code. Names are the user's, in the user's
 * language, and nothing here assumes a shape for them.
 */
const classificationSchema = z.record(z.string().min(1), z.string().min(1));

/**
 * Unknown keys are refused rather than ignored.
 *
 * Ignoring them is the dangerous default here: a misspelt `allowed_recipients`
 * would silently mean no recipient limit at all, and a `label_prefix` left over
 * from an older version would silently relabel the mailbox under a different
 * name. Both would look like a configuration that works.
 */
const accountSchema = z.strictObject({
  name: z
    .string()
    .regex(NAME_PATTERN, 'musí začínat písmenem nebo číslicí a obsahovat jen malá písmena bez diakritiky, číslice, "-" nebo "_"')
    .describe('Short name the mailbox is called by in every tool'),

  address: z.email('musí být e-mailová adresa').describe('E-mail address of the mailbox'),

  // The password itself or the name of an environment variable holding it;
  // with neither, it is taken from passwords_file. A file holding a password
  // must stay out of the repository - see warnIfSecretsNotIgnored below.
  password: z.string().min(1).optional().describe('Gmail app password'),
  password_env: z
    .string()
    .min(1)
    .optional()
    .describe('Name of an environment variable holding the Gmail app password'),

  // A team mailbox behaves differently and the caller has to know:
  // unread does not mean unhandled, and the author of a sent message cannot
  // be determined from the header, because the sender is always the mailbox.
  shared: z.boolean().default(false).describe('True if several people read this mailbox'),

  // How much of this mailbox a pass treats as work.
  //
  // "everything" suits a mailbox one person writes from: the archive holds
  // threads that person filed, and their own sent reply is how they notice a
  // thread is already answered.
  //
  // "inbox" suits a mailbox a team shares. What is in the inbox there is what
  // has not been dealt with; the archive is what somebody filed and the sent
  // folder is other people's replies to other people's threads. Neither is work
  // for whoever reads it, and both are large.
  //
  // What falls outside the scope is taken out after the search, the same way
  // drafts are, never as a condition in the query: a condition would drop the
  // whole thread and the answer would come back looking like a clean empty
  // result. A thread that is work for another reason still lists those
  // messages, so "somebody has already answered this" costs no second round
  // trip.
  //
  // The search itself still runs over the whole mailbox rather than the INBOX
  // folder. A thread keeps its messages wherever they belong, so searching one
  // folder would make the thread's own length and labels describe a fragment.
  work_scope: z
    .enum(['everything', 'inbox'])
    .default('everything')
    .describe('How much of this mailbox is work in a pass: "everything", or "inbox" for a team mailbox'),

  // Whether a pass skips mail somebody has already opened.
  //
  // For a mailbox where being read is what "dealt with" looks like: an address
  // that machines write to, whose traffic something else processes, and where
  // the few messages nobody got to are the only ones worth a look.
  //
  // Weaker than work_scope, and deliberately off by default. Archived and sent
  // are states somebody chose; read is a state a preview pane can cause. A
  // message opened on a phone drops out of the pass and never comes back,
  // because it is out of scope and therefore never labelled. Worth it only
  // where the alternative is reading everything.
  //
  // This server never sets the flag itself: every read path opens its folder
  // read-only, so looking at a mailbox does not change what it says.
  unread_only: z
    .boolean()
    .default(false)
    .describe('Whether a pass ignores messages already marked read. For an automated mailbox'),

  // Denied unless a mailbox opts in. The opposite default would look locked
  // and would not be, and sending cannot be taken back.
  can_send: z.boolean().default(false).describe('Whether the server may send from this mailbox'),

  // Whether the mail watcher (--wait) watches this mailbox. Kept here, next to
  // the rest of the mailbox's settings, so that the choice lives in one place:
  // a note in the vault that repeated it would drift from it one day (Karel,
  // 30. 9. 2026). The assistant sees it in mg_list_accounts without reading
  // this file.
  watch: z.boolean().default(false).describe('Whether the mail watcher (--wait) watches this mailbox'),

  // The labels a team uses to say who is dealing with a thread.
  //
  // Named rather than guessed, because a mailbox holds labels of several kinds
  // at once - an archive, a folder, a project - and "looks like a first name"
  // is not a rule a program can apply. A label outside this list therefore
  // never means the thread belongs to somebody; it means nothing at all.
  //
  // With my_label, a pass can answer the question the caller would otherwise
  // have to answer by reading: is this thread mine, somebody else's, or
  // unclaimed.
  assignment_labels: z
    .array(z.string().min(1))
    .optional()
    .describe('Labels this mailbox uses to say who is handling a thread, for example the team\'s first names'),

  // Which of those labels is the user of this server. Without it a pass can
  // still say whether a thread is claimed, but not by whom.
  my_label: z
    .string()
    .min(1)
    .optional()
    .describe('The one of assignment_labels that marks a thread as the user\'s own'),

  // Optional. When present it is enforced exactly, and a list that is present
  // but empty allows nobody - that is what it is for. Omitting it leaves
  // can_send as the only gate. An entry is a full address or a domain written
  // as "@example.com".
  allowed_recipients: z
    .array(z.string().min(1))
    .optional()
    .describe('Addresses or @domains this mailbox may send to. Present but empty allows nobody; omitted means no recipient limit'),

  // The whole name of the label that marks a message as already seen, written
  // out rather than assembled from a prefix and a leaf. Configurable because it
  // shows up in the user's own mailbox, where a different language - or an
  // existing system of labels - may already be in use.
  //
  // Nesting is written with "/" and is Gmail's own display nesting, not
  // inheritance: "Assistant/urgent" and "Assistant" are two independent labels, and a message
  // carrying the first does not carry the second.
  //
  // Null turns the marking off for this mailbox: nothing is labelled and the
  // pass asks only about the time boundary. That fits a mailbox somebody works
  // through by reading it - there the act of reading is what takes a message
  // out of the way, and a label would only be visible clutter in somebody
  // else's mailbox. The cost is that the boundary cannot move: a message stays
  // in the window until it is read, so such a mailbox belongs in a pass that
  // runs once a day rather than every half hour.
  processed_label: z
    .string()
    .min(1)
    .nullable()
    .default(DEFAULT_PROCESSED_LABEL)
    .describe('Whole name of the label marking a message as seen, or null for a mailbox that is never labelled'),

  // Overrides the set given at the top of the file, for a mailbox that sorts
  // its conversations differently from the rest.
  classification_labels: classificationSchema
    .optional()
    .describe('Classification labels for this mailbox only, as label name to what it means'),

  // Named so a message can ask for one by name. A mailbox writes as itself, as
  // a company, and from an address that exists for one purpose, and each of
  // those ends differently.
  signatures: z
    .record(z.string().min(1), signatureSchema)
    .optional()
    .describe('Signatures of this mailbox, as a name to where its text comes from'),

  default_signature: z
    .string()
    .min(1)
    .optional()
    .describe('Signature used when a message names none. Without it a message is signed only when asked'),

  // The addresses this mailbox may write as. Listed rather than free-form for
  // the same reason as allowed_recipients: sending under another address is
  // something the configuration should permit, not something that follows from
  // nobody having asked.
  aliases: z.array(aliasSchema).optional().describe('Verified Gmail aliases this mailbox may send from'),

  // Which port sends. Unset tries 465 and falls back to 587 when 465 cannot be
  // reached - hosting providers, company networks and hotel wifi block 465 far
  // more often than 587, and a send that never connects has sent nothing.
  smtp_port: z
    .union([z.literal(465), z.literal(587)])
    .optional()
    .describe('SMTP port: 465 (TLS) or 587 (STARTTLS). Unset tries 465 and falls back to 587'),
});

const configFileSchema = z.strictObject({
  accounts: z.array(accountSchema).min(1, 'nastav aspoň jednu schránku'),

  // The default set for every mailbox, so one system of labels does not have to
  // be written out once per mailbox. A mailbox that sets its own replaces this
  // rather than adding to it.
  classification_labels: classificationSchema
    .optional()
    .describe('Classification labels available to every mailbox, as label name to what it means'),

  // Which port sends. Unset tries 465 and falls back to 587 when 465 cannot be
  // reached - hosting providers, company networks and hotel wifi block 465 far
  // more often than 587, and a send that never connects has sent nothing.
  smtp_port: z
    .union([z.literal(465), z.literal(587)])
    .optional()
    .describe('SMTP port for every mailbox that sets none: 465 (TLS) or 587 (STARTTLS). Unset tries 465 and falls back to 587'),


  // Where attachments are written. They are saved to disk rather than returned
  // inline, because an attachment is routinely megabytes.
  download_dir: z
    .string()
    .min(1)
    .optional()
    .describe('Directory attachments are saved into; defaults to vstupy/prilohy in Miládka\'s folder, elsewhere to a folder in the system temporary directory'),

  // Which directories an outgoing message may attach a file from. Absent or
  // empty means no file may be attached at all - the same rule as
  // allowed_recipients, and for the same reason: a default that allowed any
  // path would look locked without being locked, and sending cannot be taken
  // back. Attaching is not gated by a separate switch; having nowhere to take
  // a file from is the switch.
  attachment_dirs: z
    .array(z.string().min(1))
    .optional()
    .describe('Directories an outgoing message may attach files from. Absent or empty forbids attachments entirely'),

  // The language of the line above a quoted message ("Dne ... napsal:"). It is
  // the one string this server puts into a message that somebody else reads,
  // so it belongs in the configuration rather than in the code.
  quote_locale: z
    .enum(['cs', 'en'])
    .default('cs')
    .describe('Language of the attribution line above a quoted message'),

  // App passwords kept apart from the settings, as mailbox name to password.
  // Then this file holds no secret and can go into the backup, and losing the
  // computer loses only the passwords, not the configured mailboxes (Karel,
  // 30. 9. 2026). In Miládka: .miladka/secrets/multigmail/hesla.json, which
  // is never backed up. A relative path starts at the root of Miládka's folder
  // when the server runs from her add-on folder, elsewhere at this file's.
  passwords_file: z
    .string()
    .min(1)
    .optional()
    .describe('JSON file with app passwords as mailbox name to password, kept out of the backup'),

  // When and how often the watcher checks, for all watched mailboxes.
  watch_hours: z
    .string()
    .optional()
    .describe('Hours of the day the mail watcher checks in, local time, for example "9-19". Unset: all day'),
  watch_interval: z
    .string()
    .optional()
    .describe('How often the mail watcher checks, for example "5m" (at least 1m). Unset: 5 minutes'),
});

/** A configured mailbox, with its password already resolved. */
export interface Account {
  name: string;
  address: string;
  shared: boolean;
  canSend: boolean;
  /**
   * How much of this mailbox a pass counts as work: everything, or only what is
   * in the inbox. "inbox" belongs on a team mailbox, where the archive and the
   * sent folder are other people's business.
   */
  workScope: 'everything' | 'inbox';
  /**
   * Whether a pass skips mail already marked read. True on a mailbox whose
   * traffic something else processes and where unread is what "missed" means.
   */
  unreadOnly: boolean;
  /**
   * Labels that say who is handling a thread, exactly as configured. Empty when
   * the mailbox does not work that way, and then a pass says nothing about
   * whose a thread is.
   */
  assignmentLabels: string[];
  /** Which of those labels is the user's own, or null when none was named. */
  myLabel: string | null;
  /** Addresses or @domains this mailbox may send to, or null when no list is configured. */
  allowedRecipients: string[] | null;
  /**
   * The label marking a message as seen, exactly as configured. Null on a
   * mailbox that is never labelled, where reading is what clears a message.
   */
  processedLabel: string | null;
  /**
   * Labels the assistant may put on a conversation, as name to meaning. Empty
   * when none are configured, and an empty set means the assistant classifies
   * nothing - these tools never touch a label the configuration does not name.
   */
  classificationLabels: Record<string, string>;
  /** Signatures of this mailbox by name, with their files already read. Empty when none are configured. */
  signatures: Record<string, Signature>;
  /** Signature used when a message names none, or null to leave a message unsigned unless asked. */
  defaultSignature: string | null;
  /** SMTP port to send through, or null to try 465 and fall back to 587. */
  smtpPort: 465 | 587 | null;
  /**
   * Addresses this mailbox may send as. Empty means the mailbox writes only
   * under its own address - there is no separate switch, the same way an empty
   * attachment_dirs is the switch for attachments.
   */
  aliases: Alias[];
  /** Whether the mail watcher (--wait) watches this mailbox. */
  watch: boolean;
  /** Gmail app password. Never logged and never returned by a tool. */
  password: string;
}

export interface Config {
  accounts: Account[];
  /** Absolute directory attachments are written to. */
  downloadDir: string;
  /**
   * Absolute directories an outgoing message may attach a file from. Empty
   * means attachments are off, which is the default: there is no separate
   * switch, because having nowhere to take a file from is the switch.
   */
  attachmentDirs: string[];
  /** Language of the attribution line above a quoted message. */
  quoteLocale: QuoteLocale;
  /**
   * Files that hold app passwords (absolute): this file when a mailbox has its
   * password written in it, and the passwords file. They must stay out of git.
   */
  secretFiles: string[];
  /**
   * What is wrong but does not stop the server: a password not pasted in yet.
   * That mailbox fails to log in, the others work (as before 1.4, when such a
   * mailbox failed only at login).
   */
  warnings: string[];
  /** Hours the watcher checks in, [from, to) local time, or null for all day. */
  watchHours: [number, number] | null;
  /** How often the watcher checks, or null for its default. */
  watchIntervalMs: number | null;
}

/** A problem with the configuration, phrased so the reader can fix it. */
export class ConfigError extends Error {
  override name = 'ConfigError';
}

export async function loadConfig(path: string): Promise<Config> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    throw new ConfigError(
      `Konfigurační soubor ${path} nejde přečíst. Zkontroluj cestu za --config (v Miládce v .mcp.json); ` +
        'bez Miládky zkopíruj config.example.json na config.json a vyplň ho.',
    );
  }

  let json: unknown;
  try {
    // A byte order mark is what Notepad and PowerShell 5.1 may write, and the
    // settings are now edited like any file.
    json = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch {
    // Not the parser's message: it quotes the text around the error, and in
    // this file that can be a password written without quotes. The message
    // reaches the model (mg_reload_config, the watcher) and logs.
    throw new ConfigError(
      `${path} není platný JSON. Nejčastěji chybí uvozovky kolem hodnoty nebo čárka mezi položkami. ` +
        'Nastavení bez hesel přečti a oprav; když jsou v něm hesla, nečti ho celé (návod pro asistenta, ' +
        '„Soubor s hesly bez vypsání").',
    );
  }

  const parsed = configFileSchema.safeParse(json);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => {
      const where = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      // A key that used to exist gets its own sentence. "Unrecognized key" is
      // true but unhelpful to somebody whose file worked last week, and this
      // one changes which label the mailbox is marked with.
      const message =
        issue.code === 'unrecognized_keys' && issue.keys.includes('label_prefix')
          ? 'label_prefix už není konfigurační klíč. Název štítku se teď píše celý do processed_label, ' +
            'takže z "label_prefix": "asistent" a "processed_label": "zpracováno" je ' +
            '"processed_label": "asistent/zpracováno". label_prefix smaž.'
          : issue.code === 'unrecognized_keys' && issue.keys.includes('time_horizon')
            ? 'time_horizon už není konfigurační klíč. Kam do minulosti se průchod dívá, určuje kotva, ' +
              'kterou serveru předává klient v parametru "since" nástroje mg_next_pass - datum, do kterého ' +
              'je pošta prokazatelně celá zpracovaná. Klouzavé okno v konfiguraci k tomu nepotřebuje. ' +
              'time_horizon smaž.'
            : issue.code === 'unrecognized_keys'
              ? // Most often a key of a newer version, written while the old
                // one still runs: a new version applies only in a new
                // conversation (Věrka's update to 1.3.0, 30. 9. 2026).
                `${issue.message}. Když ten klíč patří novější verzi serveru, běží ještě ta starší: nová verze platí až ` +
                'v nové konverzaci (v terminálu po /mcp a Reconnect). Jinak je to překlep.'
              : issue.message;
      return `  ${where}: ${message}`;
    });
    throw new ConfigError(`${path} není platná konfigurace:\n${problems.join('\n')}`);
  }

  // Two mailboxes under one short name would make one of them unreachable
  // without any error, which is the kind of silent loss this server exists
  // to avoid. Reject it instead.
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const account of parsed.data.accounts) {
    if (seen.has(account.name)) {
      duplicates.add(account.name);
    }
    seen.add(account.name);
  }
  if (duplicates.size > 0) {
    throw new ConfigError(
      `${path} používá stejné krátké jméno pro víc schránek: ${[...duplicates].join(', ')}. ` +
        'Krátká jména musí být jedinečná, jinak se na jednu ze schránek nedá dostat.',
    );
  }

  // Every problem is reported at once. Finding them one restart at a time is
  // needless work when the whole list is known here.
  const problems: string[] = [];
  const accounts: Account[] = [];
  const configDir = dirname(resolve(path));
  const secretFiles: string[] = [];
  const warnings: string[] = [];
  let filePasswords: Record<string, string> | null = null;
  let passwordsPath: string | null = null;
  if (parsed.data.passwords_file !== undefined) {
    passwordsPath = resolve(vaultRoot() ?? configDir, parsed.data.passwords_file);
    filePasswords = await loadPasswordsFile(passwordsPath, problems);
    secretFiles.push(passwordsPath);
  }
  if (parsed.data.accounts.some((account) => account.password !== undefined)) {
    secretFiles.push(resolve(path));
  }
  for (const account of parsed.data.accounts) {
    const password = resolvePassword(account, problems, warnings, filePasswords, passwordsPath);
    if (password === null) {
      continue;
    }

    const signatures = await loadSignatures(account.name, account.signatures ?? {}, configDir, problems);
    const aliases = (account.aliases ?? []).map((alias) => ({
      address: alias.address,
      name: alias.name ?? null,
      purpose: alias.purpose ?? null,
      defaultSignature: alias.default_signature ?? null,
    }));

    // A label that marks the user's own threads but is not among the ones the
    // team uses would quietly never match, and every thread would come back as
    // somebody else's.
    if (account.my_label !== undefined) {
      const known = (account.assignment_labels ?? []).some(
        (candidate) => candidate.toLowerCase() === account.my_label?.toLowerCase(),
      );
      if (!known) {
        problems.push(
          `schránka ${account.name}: "my_label" je "${account.my_label}", ale v "assignment_labels" takový štítek není`,
        );
      }
    }

    // A signature named but not configured leaves messages unsigned without
    // saying so, which is exactly the kind of silence this file refuses
    // everywhere else.
    for (const [where, wanted] of [
      [`schránka ${account.name}`, account.default_signature] as const,
      ...aliases.map((alias) => [`alias ${alias.address}`, alias.defaultSignature] as const),
    ]) {
      if (wanted !== null && wanted !== undefined && !(wanted in signatures)) {
        problems.push(`${where} odkazuje na podpis "${wanted}", který v "signatures" není`);
      }
    }

    accounts.push({
      name: account.name,
      address: account.address,
      shared: account.shared,
      canSend: account.can_send,
      workScope: account.work_scope,
      unreadOnly: account.unread_only,
      assignmentLabels: account.assignment_labels ?? [],
      myLabel: account.my_label ?? null,
      allowedRecipients: account.allowed_recipients ?? null,
      processedLabel: account.processed_label,
      // The mailbox's own set replaces the shared one rather than adding to it:
      // a mailbox that lists its labels is stating the whole set it uses, and
      // silently inheriting a few more would make the file mean something other
      // than what it says.
      classificationLabels: account.classification_labels ?? parsed.data.classification_labels ?? {},
      signatures,
      defaultSignature: account.default_signature ?? null,
      smtpPort: account.smtp_port ?? parsed.data.smtp_port ?? null,
      aliases,
      watch: account.watch,
      password,
    });
  }
  let watchHours: [number, number] | null = null;
  if (parsed.data.watch_hours !== undefined) {
    watchHours = parseHours(parsed.data.watch_hours);
    if (watchHours === null) {
      problems.push(`"watch_hours" je "${parsed.data.watch_hours}", čeká rozsah hodin, třeba "9-19"`);
    }
  }
  let watchIntervalMs: number | null = null;
  if (parsed.data.watch_interval !== undefined) {
    watchIntervalMs = parseDuration(parsed.data.watch_interval);
    if (watchIntervalMs === null || watchIntervalMs < 60_000) {
      problems.push(`"watch_interval" je "${parsed.data.watch_interval}", čeká třeba "5m", nejméně "1m"`);
    }
  }
  if (problems.length > 0) {
    // The hint about app passwords is only added when a password is actually
    // among the problems. Advice about something that is not wrong reads as a
    // wrong diagnosis, and sends the reader to check a setting that is fine.
    const aboutPasswords = problems.some((line) => line.includes('heslo'));
    throw new ConfigError(
      `V ${path} ${countProblems(problems.length)}:\n` +
        problems.map((line) => `  ${line}`).join('\n') +
        (aboutPasswords
          ? '\nHeslo aplikace se vygeneruje v účtu Google a vyžaduje zapnuté dvoufázové ověření.'
          : ''),
    );
  }

  return {
    accounts,
    // In Miládka's add-on folder attachments go to vstupy/prilohy in her
    // folder; elsewhere to a folder in the system temporary directory.
    downloadDir: resolve(parsed.data.download_dir ?? vaultAttachmentDir() ?? join(tmpdir(), 'mcp-multi-gmail')),
    // Resolved here, once, so every later check compares absolute paths. A
    // relative entry would otherwise be measured against whatever directory
    // the server happened to be started from.
    attachmentDirs: (parsed.data.attachment_dirs ?? []).map((dir) => resolve(dir)),
    quoteLocale: parsed.data.quote_locale,
    secretFiles,
    warnings,
    watchHours,
    watchIntervalMs,
  };
}

/**
 * The passwords file, as mailbox name to password. Its content never reaches a
 * message: a broken file is reported by its path only.
 */
async function loadPasswordsFile(path: string, problems: string[]): Promise<Record<string, string> | null> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    problems.push(`soubor s hesly ${path} nejde přečíst (neexistuje, nebo k němu nejsou práva)`);
    return null;
  }
  try {
    const json: unknown = JSON.parse(raw.replace(/^\uFEFF/, ''));
    if (typeof json !== 'object' || json === null || Array.isArray(json)) {
      throw new Error('not an object');
    }
    // No prototype: a mailbox called "constructor" must not find a function.
    const passwords: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const [name, value] of Object.entries(json)) {
      if (typeof value === 'string') {
        passwords[name] = value;
      }
    }
    return passwords;
  } catch {
    problems.push(
      `soubor s hesly ${path} není platný JSON ve tvaru {"jmeno-schranky": "..."}. ` +
        'Nejčastěji chybí uvozovky nebo čárka; obsah se kvůli heslům nevypisuje.',
    );
    return null;
  }
}

/** Czech counts one, few and many differently, and the message reads badly without it. */
function countProblems(count: number): string {
  if (count === 1) {
    return 'je problém';
  }
  return count < 5 ? `jsou ${count} problémy` : `je ${count} problémů`;
}

/** Read every signature of one mailbox, collecting problems rather than failing on the first. */
async function loadSignatures(
  account: string,
  sources: Record<string, { text?: string | undefined; text_file?: string | undefined; html?: string | undefined; html_file?: string | undefined }>,
  configDir: string,
  problems: string[],
): Promise<Record<string, Signature>> {
  const signatures: Record<string, Signature> = {};
  for (const [name, source] of Object.entries(sources)) {
    const found: string[] = [];
    const signature = await loadSignature(name, source, configDir, found);
    problems.push(...found.map((line) => `schránka ${account}: ${line}`));
    if (signature !== null) {
      signatures[name] = signature;
    }
  }
  return signatures;
}

/** What the setup writes where the user puts the password in; not a password. */
const PLACEHOLDER = 'SEM_VLOZ_HESLO_APLIKACE';

function resolvePassword(
  account: { name: string; password?: string | undefined; password_env?: string | undefined },
  problems: string[],
  warnings: string[],
  filePasswords: Record<string, string> | null,
  passwordsPath: string | null,
): string | null {
  const hasLiteral = account.password !== undefined;
  const hasEnv = account.password_env !== undefined;

  // Both would leave it unclear which one is in use, and a stale value in the
  // one that loses is a password nobody remembers is there.
  if (hasLiteral && hasEnv) {
    problems.push(`${account.name} má zároveň "password" i "password_env"; nech jen jedno z nich`);
    return null;
  }
  if (account.password !== undefined) {
    if (account.password.includes(PLACEHOLDER)) {
      warnings.push(`${account.name}: heslo ještě není vložené (v nastavení zůstal text ${PLACEHOLDER}), schránka se nepřihlásí`);
    }
    return normalizeAppPassword(account.password);
  }
  if (account.password_env !== undefined) {
    const fromEnv = process.env[account.password_env];
    if (fromEnv === undefined || fromEnv === '') {
      problems.push(`${account.name} čeká heslo v proměnné ${account.password_env}, která není nastavená`);
      return null;
    }
    return normalizeAppPassword(fromEnv);
  }
  if (passwordsPath !== null) {
    if (filePasswords === null) {
      return null; // the file itself is already reported
    }
    const fromFile = Object.hasOwn(filePasswords, account.name) ? filePasswords[account.name] : undefined;
    if (fromFile === undefined || fromFile.trim() === '') {
      problems.push(`${account.name} nemá heslo v souboru s hesly ${passwordsPath}`);
      return null;
    }
    if (fromFile.includes(PLACEHOLDER)) {
      warnings.push(`${account.name}: heslo ještě není vložené do ${passwordsPath} (zůstal text ${PLACEHOLDER}), schránka se nepřihlásí`);
    }
    return normalizeAppPassword(fromFile);
  }
  problems.push(`${account.name} nemá ani "password", ani "password_env", ani heslo v "passwords_file"`);
  return null;
}

/**
 * Strip the spaces Google shows an app password with.
 *
 * Google displays an app password as four groups of four letters, and that is
 * how people copy it. When the value without whitespace is exactly sixteen
 * lowercase letters, it is an app password with the display spacing left in,
 * and the cleaned form is used. Anything else is returned unchanged, so a
 * password of another shape is never altered behind the user's back.
 *
 * Nothing about the password is logged, not even its length.
 */
export function normalizeAppPassword(password: string): string {
  const compact = password.replace(/\s+/g, '');
  return /^[a-z]{16}$/.test(compact) ? compact : password;
}

const execFileAsync = promisify(execFile);

/**
 * Warn about every file holding app passwords (Config.secretFiles) that is
 * inside a git repository and not ignored.
 *
 * A password that reaches the history cannot be taken out of it again, and the
 * mistake is silent until somebody looks. This is the one check that catches
 * it before the commit rather than after. The settings without passwords are
 * meant to be backed up (in Miládka: system/multigmail.json), so they are not
 * checked; the add-on keeps its own check and does not rely on anything else
 * having set up .gitignore.
 *
 * Best effort: if git is missing or a file is outside a repository, nothing
 * is said about it. A warning, not a refusal, because it is the user's own
 * machine and their own call.
 *
 * @returns the warning text, or null if there is nothing to warn about
 */
export async function warnIfSecretsNotIgnored(files: string[]): Promise<string | null> {
  const warnings: string[] = [];
  for (const file of files) {
    if (await isTrackable(file)) {
      warnings.push(
        `POZOR: ${file} leží v gitovém repozitáři a není ignorovaný, a jsou v něm hesla aplikací. ` +
          'Přidej ho do .gitignore (v Miládce řádek .miladka/secrets/) nebo ho přesuň mimo repozitář, než něco ' +
          'commitneš - tajemství, které se dostane do historie, se z ní nedá odstranit.',
      );
    }
  }
  return warnings.length > 0 ? warnings.join('\n') : null;
}

/** True if the file sits in a git work tree and git would not ignore it. */
async function isTrackable(file: string): Promise<boolean> {
  const cwd = dirname(file);
  try {
    const insideRepo = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd });
    if (insideRepo.stdout.trim() !== 'true') {
      return false;
    }
  } catch {
    return false; // no git, or the folder does not exist
  }
  try {
    // Exits 0 when the path is ignored, 1 when it is not.
    await execFileAsync('git', ['check-ignore', '--quiet', '--', file], { cwd });
    return false;
  } catch (error) {
    return (error as { code?: unknown }).code === 1;
  }
}
