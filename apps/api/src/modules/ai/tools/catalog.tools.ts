import { formatMoney } from '@hadiya/shared';
import { z } from 'zod';

import * as productService from '../../products/product.service.js';
import type { RegisteredTool } from './tool-registry.js';

/**
 * A read-only window onto the shop's own catalogue.
 *
 * It exists so content can be about real products. "Shu product uchun
 * Instagram post tayyorla" needs a name, a price and a category, and the
 * alternative — letting the content engine query products itself — would mean
 * every caption request silently ran a catalogue read, and the assistant could
 * no longer choose what a post should be about.
 *
 * It calls the same service the REST API does, so nothing here can write and
 * nothing here sees more than the API would show.
 */
const MAX_PRODUCT_ROWS = 25;

export const getProductsTool: RegisteredTool = {
  name: 'get_products',
  description:
    "Look up products in the shop's own catalogue by name, SKU or barcode. Use it before writing content about a specific product, so the name, price and category are real rather than invented.",
  mutates: false,
  schema: z.object({
    search: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .optional()
      .describe('Matches the name, SKU or barcode. Leave out to list active products.'),
    limit: z.number().int().min(1).max(MAX_PRODUCT_ROWS).default(10),
  }),
  execute: async (args) => {
    const { search, limit } = args as { search?: string; limit: number };

    const { items, pagination } = await productService.listProducts({
      page: 1,
      pageSize: limit,
      isActive: true,
      ...(search ? { search } : {}),
    });

    if (items.length === 0) {
      return {
        summary: search
          ? `No active product matches "${search}".`
          : 'The catalogue has no active products.',
        data: { items: [], total: 0 },
      };
    }

    const rows = items.map((product) => ({
      id: String(product._id),
      name: product.name,
      sku: product.sku,
      price: product.price,
      // The model reads the summary, so money is formatted rather than left as
      // the minor units it would have to divide itself.
      priceLabel: formatMoney(product.price),
      unit: product.unit,
    }));

    return {
      summary: `${pagination.total} product(s): ${rows
        .map((product) => `${product.name} (${product.priceLabel})`)
        .join(', ')}`,
      data: { items: rows, total: pagination.total },
    };
  },
};

export const CATALOG_TOOLS: readonly RegisteredTool[] = [getProductsTool];
