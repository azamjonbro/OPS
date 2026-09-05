import type { z } from 'zod';

import type {
  billzCustomerQuerySchema,
  billzInventoryQuerySchema,
  billzPeriodQuerySchema,
  billzProductQuerySchema,
  billzSalesQuerySchema,
} from './billz.validators.js';

/**
 * Parsed query shapes, kept apart from the schemas so the service layer can be
 * typed against them without importing Zod.
 */
export type BillzProductQuery = z.output<typeof billzProductQuerySchema>;
export type BillzCustomerQuery = z.output<typeof billzCustomerQuerySchema>;
export type BillzSalesQuery = z.output<typeof billzSalesQuerySchema>;
export type BillzPeriodQuery = z.output<typeof billzPeriodQuerySchema>;
export type BillzInventoryQuery = z.output<typeof billzInventoryQuerySchema>;
