import { ANALYTICS_MAX_RANKING, ANALYTICS_PERIODS } from '@hadiya/shared';
import { z } from 'zod';

/**
 * What the dashboard may ask for.
 *
 * The same period vocabulary the assistant's tools use, so a figure a person
 * reads on the screen and a figure they ask the assistant about are the same
 * figure over the same days. A second, screen-only notion of "this month" is
 * how two parts of one product start disagreeing in front of a customer.
 */
const isoDay = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const dashboardQuerySchema = z
  .object({
    period: z.enum(ANALYTICS_PERIODS).default('this_month'),
    from: isoDay.optional(),
    to: isoDay.optional(),
    /** How many products the "top" list holds. */
    topLimit: z.coerce.number().int().min(1).max(ANALYTICS_MAX_RANKING).default(5),
    /** Quantity at or below which stock counts as low. */
    lowStockThreshold: z.coerce.number().int().min(0).max(1_000).default(5),
  })
  .refine((value) => value.period !== 'custom' || (value.from !== undefined && value.to !== undefined), {
    message: 'A custom period needs both from and to.',
    path: ['period'],
  });
