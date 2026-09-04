import { sendCreated, sendPaginated, sendSuccess } from '../../core/http/api-response.js';
import { ApiError } from '../../core/http/api-error.js';
import { requireActor } from '../../core/security/actor.js';
import type { ValidatedHandler } from '../../core/middleware/validate.js';
import * as reminderService from './reminder.service.js';
import type {
  createReminderSchema,
  listRemindersQuerySchema,
  reminderIdParamSchema,
  updateReminderSchema,
} from './reminder.validators.js';

/**
 * A request cannot be asked a follow-up question the way a conversation can, so
 * an under-specified time comes back as a 400 carrying the question. The
 * assistant reaches the same service directly and does ask.
 */
const clarification = (question: string): ApiError =>
  ApiError.badRequest(question, { details: { needsClarification: true } });

export const create: ValidatedHandler<{ body: typeof createReminderSchema }> = async (req, res) => {
  const result = await reminderService.createReminder(requireActor(req), req.validated.body);

  if (result.outcome === 'needs_clarification') {
    throw clarification(result.question);
  }

  sendCreated(req, res, reminderService.toView(result.reminder));
};

export const list: ValidatedHandler<{ query: typeof listRemindersQuerySchema }> = async (
  req,
  res,
) => {
  const result = await reminderService.listReminders(requireActor(req), req.validated.query);

  sendPaginated(req, res, {
    items: result.items.map(reminderService.toView),
    pagination: result.pagination,
  });
};

export const detail: ValidatedHandler<{ params: typeof reminderIdParamSchema }> = async (
  req,
  res,
) => {
  const reminder = await reminderService.getReminder(requireActor(req), req.validated.params.id);

  sendSuccess(req, res, reminderService.toView(reminder));
};

export const update: ValidatedHandler<{
  params: typeof reminderIdParamSchema;
  body: typeof updateReminderSchema;
}> = async (req, res) => {
  const result = await reminderService.updateReminder(
    requireActor(req),
    req.validated.params.id,
    req.validated.body,
  );

  if (result.outcome === 'needs_clarification') {
    throw clarification(result.question);
  }

  sendSuccess(req, res, reminderService.toView(result.reminder));
};

export const cancel: ValidatedHandler<{ params: typeof reminderIdParamSchema }> = async (
  req,
  res,
) => {
  const reminder = await reminderService.cancelReminder(requireActor(req), req.validated.params.id);

  sendSuccess(req, res, reminderService.toView(reminder));
};
