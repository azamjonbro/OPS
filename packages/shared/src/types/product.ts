import type { ExternalSource, ProductUnit } from '../constants/products.js';
import type { Entity, MinorUnits } from './entity.js';

export interface ProductImage {
  url: string;
  alt: string | null;
  /** Exactly one image per product is primary. */
  isPrimary: boolean;
  sortOrder: number;
}

/**
 * Maps this product onto a record in an external system. Kept as a list so a
 * product can be linked to more than one integration over its lifetime, and so
 * a future Billz sync matches on an explicit id instead of guessing by name.
 */
export interface ProductExternalRef {
  source: ExternalSource;
  externalId: string;
  /** ISO-8601 timestamp of the last successful sync. */
  syncedAt: string | null;
}

export interface Product extends Entity {
  name: string;
  /** Internal stock-keeping unit; unique and immutable once assigned. */
  sku: string;
  /** Scanned barcode (EAN/UPC); unique when present. */
  barcode: string | null;
  description: string | null;
  categoryId: string;
  /** Selling price in minor units. */
  price: MinorUnits;
  /** Purchase cost in minor units; used for margin reporting. */
  costPrice: MinorUnits;
  currency: string;
  unit: ProductUnit;
  /**
   * Whether stock is tracked for this product. Services (a haircut, a delivery
   * fee) are sold without touching inventory.
   */
  trackInventory: boolean;
  /** Stock level at or below which the product should be reordered. */
  reorderLevel: number;
  isActive: boolean;
  images: ProductImage[];
  externalRefs: ProductExternalRef[];
}
