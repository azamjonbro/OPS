import {
  booleanQuerySchema,
  EXTERNAL_SOURCES,
  objectIdSchema,
  paginationQuerySchema,
  PRODUCT_UNITS,
} from '@hadiya/shared';
import { z } from 'zod';

/** Money is an integer count of minor units; fractions are a client bug. */
const minorUnitsSchema = z.number().int().min(0);

const skuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(2)
  .max(64)
  .regex(/^[A-Z0-9._-]+$/, 'Only capital letters, digits, dot, underscore and hyphen are allowed');

const barcodeSchema = z
  .string()
  .trim()
  .min(6)
  .max(64)
  .regex(/^[0-9A-Za-z-]+$/, 'Must be a scannable barcode value');

const imageSchema = z.object({
  url: z.url().max(2048),
  alt: z.string().trim().max(240).nullish(),
  isPrimary: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

const externalRefSchema = z.object({
  source: z.enum(EXTERNAL_SOURCES),
  externalId: z.string().trim().min(1).max(120),
});

export const createProductSchema = z.object({
  name: z.string().trim().min(2).max(200),
  sku: skuSchema,
  barcode: barcodeSchema.nullish(),
  description: z.string().trim().max(2000).nullish(),
  categoryId: objectIdSchema,
  price: minorUnitsSchema,
  costPrice: minorUnitsSchema.optional(),
  currency: z.string().trim().toUpperCase().length(3).optional(),
  unit: z.enum(PRODUCT_UNITS).optional(),
  trackInventory: z.boolean().optional(),
  reorderLevel: z.number().int().min(0).optional(),
  images: z.array(imageSchema).max(12).optional(),
  externalRefs: z.array(externalRefSchema).max(4).optional(),
});

export const updateProductSchema = z
  .object({
    name: z.string().trim().min(2).max(200),
    barcode: barcodeSchema.nullable(),
    description: z.string().trim().max(2000).nullable(),
    categoryId: objectIdSchema,
    price: minorUnitsSchema,
    costPrice: minorUnitsSchema,
    unit: z.enum(PRODUCT_UNITS),
    trackInventory: z.boolean(),
    reorderLevel: z.number().int().min(0),
    isActive: z.boolean(),
    images: z.array(imageSchema).max(12),
    externalRefs: z.array(externalRefSchema).max(4),
  })
  .partial();

export const listProductsQuerySchema = paginationQuerySchema.extend({
  categoryId: objectIdSchema.optional(),
  isActive: booleanQuerySchema.optional(),
  /** Matches name, SKU or barcode — what a cashier types into the search box. */
  search: z.string().trim().min(1).max(80).optional(),
  sku: skuSchema.optional(),
  barcode: barcodeSchema.optional(),
});

export const productIdParamSchema = z.object({ id: objectIdSchema });

export type CreateProductInput = z.output<typeof createProductSchema>;
export type UpdateProductInput = z.output<typeof updateProductSchema>;
export type ListProductsQuery = z.output<typeof listProductsQuerySchema>;
