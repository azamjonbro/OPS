import {
  DESTRUCTIVE_TOOL_VERBS,
  defaultPermissionForRisk,
  type McpToolPermission,
  type McpToolRisk,
} from '@hadiya/shared';

/**
 * How dangerous a discovered tool looks, and what it may therefore do by
 * default.
 *
 * Everything this file reads — the tool's name, its description, its
 * annotations — was written by the server being judged. So the classification
 * is not a security control and is never treated as one. It exists to choose a
 * sensible starting permission, and it is built so that its mistakes fall the
 * safe way:
 *
 *  - A server claiming `readOnlyHint: true` is believed only when nothing else
 *    contradicts it. A tool called `delete_customer` that says it is read-only
 *    is destructive, and the lie is itself a reason to distrust the server.
 *  - Anything that cannot be classified is `unknown`, which asks before running.
 *  - Nothing here can produce `enabled` for a tool that writes.
 *
 * The only decision that actually gates execution is the stored permission,
 * which a person can change and which is re-read from the database at call
 * time.
 */

export interface ToolAnnotations {
  readOnlyHint?: boolean | undefined;
  destructiveHint?: boolean | undefined;
  idempotentHint?: boolean | undefined;
}

export interface ClassifyToolInput {
  name: string;
  description: string;
  annotations?: ToolAnnotations | undefined;
}

/** Words that mean a tool only looks. */
const READ_VERBS = [
  'browse',
  'check',
  'describe',
  'fetch',
  'find',
  'get',
  'list',
  'lookup',
  'query',
  'read',
  'retrieve',
  'search',
  'show',
  'summarise',
  'summarize',
  'view',
] as const;

/** Words that mean a tool changes something without destroying it. */
const WRITE_VERBS = [
  'add',
  'append',
  'archive',
  'assign',
  'cancel',
  'close',
  'create',
  'disable',
  'edit',
  'enable',
  'export',
  'import',
  'insert',
  'invite',
  'issue',
  'merge',
  'move',
  'new',
  'notify',
  'patch',
  'post',
  'publish',
  'put',
  'rename',
  'schedule',
  'send',
  'set',
  'submit',
  'sync',
  'update',
  'upload',
  'upsert',
  'write',
] as const;

/**
 * Splits a tool name into the words it is made of.
 *
 * `search_customers`, `searchCustomers` and `search-customers` are the same
 * tool named three ways, and a classifier that only understood one of them
 * would let the other two through unclassified.
 */
const wordsIn = (value: string): string[] =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());

const containsAny = (words: string[], vocabulary: readonly string[]): boolean =>
  words.some((word) => vocabulary.includes(word));

/**
 * Whether anything about this tool says "destroys data".
 *
 * The name is weighted heavily and the description lightly, because a
 * description mentioning deletion in passing ("returns the customer, including
 * deleted ones") should not condemn a read. The name is where a tool declares
 * what it does.
 */
const looksDestructive = (input: ClassifyToolInput): boolean => {
  const nameWords = wordsIn(input.name);

  if (containsAny(nameWords, DESTRUCTIVE_TOOL_VERBS)) {
    return true;
  }

  if (input.annotations?.destructiveHint === true) {
    return true;
  }

  // In the description, a destructive verb counts only next to an object: "this
  // will delete the record" rather than a stray "deleted".
  return DESTRUCTIVE_TOOL_VERBS.some((verb) =>
    new RegExp(`\\b${verb}s?\\b\\s+(the\\s+|a\\s+|all\\s+|every\\s+)?\\w`, 'i').test(
      input.description,
    ),
  );
};

/** What Hadiya believes a tool does. */
export const classifyToolRisk = (input: ClassifyToolInput): McpToolRisk => {
  if (looksDestructive(input)) {
    return 'destructive';
  }

  const nameWords = wordsIn(input.name);

  if (containsAny(nameWords, WRITE_VERBS)) {
    return 'write';
  }

  // The server's own read-only claim is accepted here and only here: after
  // destructive and write verbs have both had their say, so a claim cannot
  // override the evidence against it.
  if (input.annotations?.readOnlyHint === true) {
    return 'read';
  }

  if (containsAny(nameWords, READ_VERBS)) {
    return 'read';
  }

  // A name that says nothing. Not an error — plenty of tools are called
  // `customers` — but not something to run unattended either.
  return 'unknown';
};

/**
 * The permission a freshly discovered tool starts with.
 *
 * A tool Hadiya has seen before keeps whatever the person chose for it:
 * re-running discovery must not quietly re-open something they closed, and it
 * must not re-close something they deliberately allowed. That is the whole
 * reason `permissionSetAt` exists.
 */
export const initialPermissionFor = (
  risk: McpToolRisk,
  previous?: { permission: McpToolPermission; permissionSetAt: Date | null } | undefined,
): { permission: McpToolPermission; permissionSetAt: Date | null } => {
  if (previous && previous.permissionSetAt !== null) {
    return { permission: previous.permission, permissionSetAt: previous.permissionSetAt };
  }

  // Never set by a person, so the current classification decides — which means
  // a tool that has become destructive since it was last seen is demoted rather
  // than left on the permission its old, gentler name earned.
  return { permission: defaultPermissionForRisk(risk), permissionSetAt: null };
};

/** How a permission reads on a screen and in an audit row. */
export const describePermission = (permission: McpToolPermission): string => {
  switch (permission) {
    case 'enabled':
      return 'runs without asking';
    case 'requires_confirmation':
      return 'asks before it runs';
    case 'disabled':
      return 'switched off';
    case 'blocked':
      return 'blocked';
  }
};
