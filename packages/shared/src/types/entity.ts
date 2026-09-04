/**
 * Shape of every entity as it appears on the wire.
 *
 * The API stores `_id` and Date objects; the response serializer renames `_id`
 * to `id` and JSON encodes dates as ISO-8601 strings. These types describe what
 * a client actually receives. Reference fields keep the name they have in the
 * database (`branch`, `category`, `product`) and always hold a string id — the
 * API does not populate them.
 */
export interface Identified {
  id: string;
}

export interface Timestamped {
  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601. */
  updatedAt: string;
}

export type Entity = Identified & Timestamped;

/** Money is always an integer count of minor units (tiyin, cents). */
export type MinorUnits = number;
