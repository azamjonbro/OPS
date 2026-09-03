/** Units a product is sold in; decides whether fractional quantities are legal. */
export const PRODUCT_UNITS = ['piece', 'kg', 'gram', 'litre', 'metre', 'package'] as const;

export type ProductUnit = (typeof PRODUCT_UNITS)[number];

/** Units that may be sold in fractions (0.5 kg); the rest must be whole numbers. */
const FRACTIONAL_UNITS: ReadonlySet<ProductUnit> = new Set<ProductUnit>([
  'kg',
  'gram',
  'litre',
  'metre',
]);

export const allowsFractionalQuantity = (unit: ProductUnit): boolean => FRACTIONAL_UNITS.has(unit);

/**
 * External systems a product can be mapped to. A product carries at most one
 * reference per source, which is how a future Billz sync matches records
 * instead of guessing by name or SKU.
 */
export const EXTERNAL_SOURCES = ['billz'] as const;

export type ExternalSource = (typeof EXTERNAL_SOURCES)[number];
