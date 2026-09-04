/** Billz resources Hadiya imports into its own collections. */
export const SYNC_RESOURCES = ['categories', 'products', 'customers', 'branches'] as const;

export type SyncResource = (typeof SYNC_RESOURCES)[number];

/**
 * `full` walks everything; `incremental` asks Billz only for records changed
 * since the stored cursor. Only products support a real incremental window —
 * `/v2/products` accepts `last_updated_date` — so the others fall back to a
 * full walk that is made cheap by skipping unchanged records.
 */
export const SYNC_MODES = ['full', 'incremental'] as const;

export type SyncMode = (typeof SYNC_MODES)[number];

export const SYNC_RUN_STATUSES = ['running', 'succeeded', 'failed'] as const;

export type SyncRunStatus = (typeof SYNC_RUN_STATUSES)[number];

/**
 * Order matters: a product references its category and a customer its branch,
 * so the things being pointed at are imported first.
 */
export const SYNC_ORDER: readonly SyncResource[] = [
  'branches',
  'categories',
  'products',
  'customers',
];
