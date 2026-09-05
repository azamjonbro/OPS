import type { AnalyticsDataQuality } from '@hadiya/shared';

/**
 * Billz data, flattened into the shape the calculators want.
 *
 * The normalisation exists so that arithmetic never has to know how Billz
 * shapes a receipt — and, more importantly, so that a day is decided *once*, in
 * the actor's zone, rather than re-derived by every function that buckets
 * something. `localDate` is the whole reason this type exists.
 */
export interface NormalisedLine {
  productExternalId: string | null;
  name: string;
  quantity: number;
  /** Minor units, already net of the line's own discount. */
  lineTotal: number;
}

export interface NormalisedReceipt {
  externalId: string;
  /** Billz reports a return as its own receipt with a negative total. */
  isReturn: boolean;
  /** Signed minor units: negative for a return, so summing nets correctly. */
  total: number;
  /** Left unpaid on this receipt. Zero when it was settled. */
  debtAmount: number;
  shopExternalId: string | null;
  shopName: string | null;
  customerExternalId: string | null;
  /** `YYYY-MM-DD` as read in the actor's zone — never in UTC. */
  localDate: string;
  lines: NormalisedLine[];
}

/**
 * Receipts for a window, plus an honest account of what is missing from them.
 *
 * The two travel together on purpose. Handing back a bare array would let a
 * caller compute a confident total from half a month without ever learning
 * that it was half.
 */
export interface ReceiptWindow {
  receipts: NormalisedReceipt[];
  quality: AnalyticsDataQuality;
}
