import {
  ALERT_SEVERITIES,
  ALERT_STATUSES,
  ALERT_TYPES,
  objectIdSchema,
  paginationQuerySchema,
} from '@hadiya/shared';
import { z } from 'zod';

export const listAlertsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(ALERT_STATUSES).optional(),
  severity: z.enum(ALERT_SEVERITIES).optional(),
  type: z.enum(ALERT_TYPES).optional(),
  /** Defaults to the open list, which is what somebody opening the page wants. */
  activeOnly: z.coerce.boolean().default(true),
});

export const alertIdParamSchema = z.object({ id: objectIdSchema });

/**
 * Quiet hours as minutes past local midnight.
 *
 * Minutes rather than a `HH:mm` string so a window crossing midnight needs no
 * special parsing, and so the stored value cannot be ambiguous about its zone —
 * it is always the account's own wall clock.
 */
const quietHoursSchema = z.object({
  enabled: z.boolean(),
  startMinute: z.number().int().min(0).max(1_439),
  endMinute: z.number().int().min(0).max(1_439),
  allowCritical: z.boolean(),
});

export const updateAlertPreferencesSchema = z
  .object({
    disabledTypes: z.array(z.enum(ALERT_TYPES)).max(ALERT_TYPES.length).optional(),
    minSeverity: z.enum(ALERT_SEVERITIES).optional(),
    quietHours: quietHoursSchema.optional(),
  })
  .refine(
    (value) => Object.values(value).some((entry) => entry !== undefined),
    'Give at least one preference to change',
  );

export const alertActionSchema = z.object({ action: z.enum(['acknowledge', 'dismiss']) });
