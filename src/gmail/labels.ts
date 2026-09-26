// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karel Derfl

/**
 * Reading and writing Gmail labels (X-GM-LABELS).
 *
 * Labelling exists so that an assistant working through a mailbox repeatedly
 * knows what it has already been through. A time window alone cannot carry
 * that: it returns the same mail on every pass and an interrupted pass cannot
 * be picked up. A label can, and it is exact rather than approximate.
 *
 * **The label answers one question: does this message belong in the next pass
 * or not.** It is not a verdict on the message. Noise carries it, and so does
 * a message still waiting for an answer - both have been looked at, and
 * neither needs reading again. What a conversation still needs is a separate
 * classification, and that one goes on the thread.
 *
 * **A message label and a thread label are different operations and this
 * module keeps them apart.** Gmail's thread labelling also reaches messages
 * that arrive in the thread later, so putting the pass label on a thread would
 * mark a future reply as already looked at before anyone read it. That is why
 * it belongs on the individual message, and only the classification of the
 * whole conversation belongs on the thread.
 *
 * **Every message gets its own result and nothing is reported per batch.** The
 * caller decides from these results how far its time boundary may move, so one
 * message that could not be labelled must be neither hidden inside an overall
 * success nor allowed to fail the whole call. A batch that half worked is the
 * normal case, not an error.
 *
 * Every change is read back before it is reported. A STORE that the server
 * accepts but does not act on would otherwise leave the caller believing a
 * message is marked when it is not - and the whole mechanism rests on that
 * mark being true. The read-back is a FETCH of those messages, never a search:
 * the search index is updated some time after a label is written and would
 * answer with what was true a moment ago.
 */

import type { ImapFlow } from 'imapflow';

import type { Account } from '../config.js';
import { ToolError } from '../errors.js';
import { normaliseMessageId, searchByMessageId } from './lookup.js';
import { withAllMail, withClient } from './session.js';

export interface LabelInfo {
  label: string;
  /** True for a folder Gmail maintains itself (All Mail, Sent, Trash, …) rather than a label the user made. */
  system: boolean;
}

/** What happened to one message. Only `changed` and `already` mean it is in the intended state. */
export type LabelOutcome =
  /** The label was applied or removed by this call. */
  | 'changed'
  /** The message was already in the intended state, which is not an error: a repeated pass is expected. */
  | 'already'
  /** No message with that Message-ID in this mailbox. */
  | 'not_found'
  /** Gmail did not put the message in the intended state, read back after the change. */
  | 'failed';

export interface MessageLabelResult {
  /** The stable reference, as it was asked for. Null for a thread message with no Message-ID header. */
  message_id: string | null;
  /** Working identifier inside this folder and this call only. Null when the message was not found. */
  uid: number | null;
  outcome: LabelOutcome;
  /** Why, when the outcome is not `changed` or `already`. Null otherwise. */
  detail: string | null;
}

export interface LabelChange {
  account: string;
  label: string;
  /** Whether the label was being added or removed. */
  action: 'added' | 'removed';
  /** True when the label had to be created first. */
  label_created: boolean;
  /** Messages that are in the intended state, whether or not this call put them there. */
  succeeded: number;
  /** Messages that are not. Every one of them is in `messages` with a reason. */
  failed: number;
  messages: MessageLabelResult[];
}

export interface ThreadLabelChange extends LabelChange {
  thread_id: string;
  /** The configured classifications the thread carried before this call. Normally none or one. */
  classification_before: string[];
  /** What it carries now, read back rather than assumed. */
  classification_after: string[];
  /** Classifications taken off because a thread carries one classification, not several. */
  replaced: string[];
}

export async function listLabels(account: Account): Promise<LabelInfo[]> {
  return withClient(account, async (client) => {
    const folders = await client.list();
    return folders
      .map((folder) => ({ label: folder.path, system: folder.specialUse !== undefined }))
      .sort((left, right) => left.label.localeCompare(right.label));
  });
}

/**
 * Add or remove a label on messages, addressed by their Message-IDs.
 *
 * One call, however many messages. Every tool call opens its own connection to
 * Gmail and logging in costs about as much as the work itself, so labelling
 * forty messages one at a time is forty logins for forty stores.
 */
export async function changeMessageLabels(
  account: Account,
  messageIds: string[],
  label: string,
  action: 'added' | 'removed',
): Promise<LabelChange> {
  assertLabelAllowed(account, label, 'message');
  if (messageIds.length === 0) {
    throw new ToolError('not_found', 'No message was given to label.');
  }

  return withAllMail(
    account,
    async ({ client }) => {
      // Every id is resolved first, and one that is not there becomes a result
      // rather than an exception: a message deleted since the search must not
      // stop the rest of the batch from being marked.
      const found = new Map<number, string | null>();
      const missing: MessageLabelResult[] = [];
      for (const id of messageIds) {
        const bare = normaliseMessageId(id);
        const uid = bare === '' ? null : await uidOf(client, bare);
        if (uid === null) {
          missing.push({
            message_id: bare === '' ? null : bare,
            uid: null,
            outcome: 'not_found',
            detail:
              `No message with Message-ID <${bare}> in mailbox "${account.name}". Message-IDs belong to the ` +
              'mailbox they were found in, so one from another mailbox will not be here.',
          });
          continue;
        }
        found.set(uid, bare);
      }

      const applied = await applyLabel(client, found, label, action);
      return summarise(account, label, action, applied.created, [...missing, ...applied.messages]);
    },
    { readOnly: false },
  );
}

/**
 * Add or remove a label on every message of one thread.
 *
 * Gmail treats a label on a thread as belonging to the conversation, so it also
 * reaches messages that arrive in the thread later. That makes this the right
 * place for a classification of the conversation and the wrong place for a
 * record of what has been through a pass.
 */
export async function changeThreadLabel(
  account: Account,
  threadId: string,
  label: string,
  action: 'added' | 'removed',
): Promise<ThreadLabelChange> {
  assertLabelAllowed(account, label, 'thread');
  return withAllMail(
    account,
    async ({ client }) => {
      const uids = await client.search({ threadId }, { uid: true });
      if (uids === false || uids.length === 0) {
        throw new ToolError(
          'not_found',
          `No thread ${threadId} in mailbox "${account.name}". Thread ids come from mg_next_pass or mg_search_threads.`,
        );
      }

      // The Message-IDs are read so the per-message results name something the
      // caller can act on afterwards. A UID cannot be used for that.
      const identified = new Map<number, string | null>();
      const fetched = await client.fetchAll(uids, { uid: true, envelope: true }, { uid: true });
      for (const message of fetched) {
        identified.set(message.uid, message.envelope?.messageId ?? null);
      }
      for (const uid of uids) {
        if (!identified.has(uid)) {
          identified.set(uid, null);
        }
      }

      const before = await classificationOf(client, account, uids);
      const applied = await applyLabel(client, identified, label, action);

      // A thread carries one classification, so setting one is setting, not
      // adding: the others come off in the same call. Doing it in two calls
      // would leave a moment where the thread is in two categories at once, or
      // in none - and a thread in no category reads as one nobody has looked
      // at yet, which is the worse of those two lies.
      //
      // The new one goes on first and the others come off after, so an
      // interruption between them leaves the thread classified twice rather
      // than not at all.
      const replaced: string[] = [];
      if (action === 'added') {
        const others = before.filter((current) => !sameLabel(current, label));
        if (others.length > 0) {
          await client.messageFlagsRemove(uids, others, { uid: true, useLabels: true });
          replaced.push(...others);
        }
      }

      const after = await classificationOf(client, account, uids);
      return {
        ...summarise(account, label, action, applied.created, applied.messages),
        thread_id: threadId,
        classification_before: before,
        classification_after: after,
        replaced,
      };
    },
    { readOnly: false },
  );
}

/**
 * The configured classifications a thread carries right now, read from its
 * messages rather than assumed.
 *
 * Normally none or one. More than one means the thread was labelled outside
 * these tools, and the next classification set here will tidy it up.
 */
async function classificationOf(
  client: ImapFlow,
  account: Account,
  uids: number[],
): Promise<string[]> {
  const configured = Object.keys(account.classificationLabels);
  if (configured.length === 0) {
    return [];
  }
  const present = new Set<string>();
  const messages = await client.fetchAll(uids, { uid: true, labels: true }, { uid: true });
  for (const message of messages) {
    for (const value of message.labels ?? []) {
      const match = configured.find((candidate) => sameLabel(candidate, value));
      if (match !== undefined) {
        present.add(match);
      }
    }
  }
  return [...present].sort();
}

function sameLabel(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

interface AppliedLabel {
  created: boolean;
  messages: MessageLabelResult[];
}

async function applyLabel(
  client: ImapFlow,
  messages: Map<number, string | null>,
  label: string,
  action: 'added' | 'removed',
): Promise<AppliedLabel> {
  const uids = [...messages.keys()];
  if (uids.length === 0) {
    return { created: false, messages: [] };
  }

  // Gmail will not apply a label that does not exist, and the STORE reports no
  // error when that happens. Creating it first is what turns a silent no-op
  // into a change that actually holds.
  const created = action === 'added' ? await ensureLabel(client, label) : false;

  const wanted = action === 'added';
  const before = await carrying(client, uids, label);
  // Messages already in the intended state are left alone. Storing again would
  // work, but this keeps the change to what actually changes.
  const toChange = uids.filter((uid) => before.has(uid) !== wanted);

  let accepted = true;
  if (toChange.length > 0) {
    accepted = wanted
      ? await client.messageFlagsAdd(toChange, [label], { uid: true, useLabels: true })
      : await client.messageFlagsRemove(toChange, [label], { uid: true, useLabels: true });
  }

  const after = await carrying(client, uids, label);
  return {
    created,
    messages: uids.map((uid) => {
      const messageId = messages.get(uid) ?? null;
      if (after.has(uid) === wanted) {
        return {
          message_id: messageId,
          uid,
          outcome: before.has(uid) === wanted ? ('already' as const) : ('changed' as const),
          detail: null,
        };
      }
      return {
        message_id: messageId,
        uid,
        outcome: 'failed' as const,
        detail: accepted
          ? `Gmail accepted the change but the label "${label}" was not on the message when it was read back.`
          : `Gmail refused to ${wanted ? 'apply' : 'remove'} the label "${label}".`,
      };
    }),
  };
}

function summarise(
  account: Account,
  label: string,
  action: 'added' | 'removed',
  labelCreated: boolean,
  messages: MessageLabelResult[],
): LabelChange {
  const succeeded = messages.filter(
    (result) => result.outcome === 'changed' || result.outcome === 'already',
  ).length;
  return {
    account: account.name,
    label,
    action,
    label_created: labelCreated,
    succeeded,
    failed: messages.length - succeeded,
    messages,
  };
}

/** The UID of a message in the folder currently open, or null when it is not there. */
async function uidOf(client: ImapFlow, messageId: string): Promise<number | null> {
  const uids = await searchByMessageId(client, messageId);
  if (uids.length === 0) {
    return null;
  }
  // The newest copy, which is the one a mailbox holding the same Message-ID
  // twice picked up most recently.
  return Math.max(...uids);
}

/** @returns true if the label had to be created */
async function ensureLabel(client: ImapFlow, label: string): Promise<boolean> {
  const folders = await client.list();
  if (folders.some((folder) => folder.path.toLowerCase() === label.toLowerCase())) {
    return false;
  }
  // Split on "/" so the nesting is rebuilt with whatever delimiter the server
  // uses, rather than assuming the path separator.
  const result = await client.mailboxCreate(label.split('/'));
  return result.created;
}

/** Which of these messages carry the label right now, asked of the messages themselves. */
async function carrying(client: ImapFlow, uids: number[], label: string): Promise<Set<number>> {
  const wanted = label.toLowerCase();
  const carriers = new Set<number>();
  const messages = await client.fetchAll(uids, { uid: true, labels: true }, { uid: true });
  for (const message of messages) {
    for (const value of message.labels ?? []) {
      if (value.toLowerCase() === wanted) {
        carriers.add(message.uid);
        break;
      }
    }
  }
  return carriers;
}

/**
 * Refuse any label the configuration does not name.
 *
 * **The configured set is the whole set these tools may touch, in either
 * direction.** The mailbox belongs to the user and so does the system of
 * labels in it. Adding one that was never declared leaves clutter behind that
 * the user then has to find and delete; removing one quietly takes away
 * something they put there, and that is the worse of the two, because a label
 * that is suddenly gone shows up nowhere at all.
 *
 * Gmail's own labels are refused for a different reason. Names beginning with
 * a backslash - \Inbox, \Sent, \Trash, \Starred and the rest - are not labels
 * but archiving, starring and deleting, each with consequences of its own.
 */
function assertLabelAllowed(account: Account, label: string, scope: 'message' | 'thread'): void {
  const wanted = label.trim();
  if (wanted === '') {
    throw new ToolError('not_found', 'An empty label name cannot be applied.');
  }
  if (wanted.startsWith('\\')) {
    throw new ToolError(
      'label_forbidden',
      `"${label}" is one of Gmail's own labels. Changing those means archiving, starring or deleting a message, ` +
        'which these tools do not do. Use a label from the configuration.',
    );
  }

  const classifications = Object.keys(account.classificationLabels);
  const isProcessed = account.processedLabel !== null && sameLabel(wanted, account.processedLabel);
  const isClassification = classifications.some((candidate) => sameLabel(candidate, wanted));

  if (scope === 'message' && isProcessed) {
    return;
  }
  if (scope === 'thread' && isClassification) {
    return;
  }

  // The two kinds are not interchangeable and that difference is the whole
  // mechanism, so each tool takes only its own kind.
  if (scope === 'message' && isClassification) {
    throw new ToolError(
      'label_forbidden',
      `"${label}" is a classification and belongs on the thread, not on a message. Gmail lists threads, so a ` +
        'classification put on one message of a conversation is invisible to the user. Use mg_label_thread.',
    );
  }
  if (scope === 'thread' && isProcessed) {
    throw new ToolError(
      'label_forbidden',
      `"${label}" records that a message has been through a pass and belongs on the message, not on the ` +
        'thread. Gmail puts a thread label on replies that arrive later, so on a thread it would mark the ' +
        'reply that arrives tomorrow as already seen before anyone read it, and that message would never ' +
        'come back in a pass. Use mg_label_message with the list of messages you looked at.',
    );
  }

  const allowed =
    scope === 'message'
      ? account.processedLabel === null
        ? []
        : [account.processedLabel]
      : classifications;

  throw new ToolError(
    'label_forbidden',
    `"${label}" is not a label configured for mailbox "${account.name}", so it was neither applied nor removed. ` +
      `On a ${scope} these tools take only: ${allowed.length === 0 ? '(none configured)' : allowed.join(', ')}. ` +
      'Every other label in the mailbox is the user\'s own - mg_list_accounts reports the configured ones and ' +
      'what each of them means. To use a new one, add it to classification_labels in the configuration file and ' +
      'reconnect this server so it reads the file again.',
  );
}
