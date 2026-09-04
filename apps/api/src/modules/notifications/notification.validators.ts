import { NOTIFICATION_STATUSES, objectIdSchema, paginationQuerySchema } from '@hadiya/shared';
import { z } from 'zod';

export const listNotificationsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(NOTIFICATION_STATUSES).optional(),
});

export const notificationIdParamSchema = z.object({ id: objectIdSchema });
