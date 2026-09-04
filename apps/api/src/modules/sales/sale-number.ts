import type { ClientSession } from 'mongoose';

import { SaleModel } from './sale.model.js';

const SEQUENCE_LENGTH = 4;

const datePart = (date: Date): string =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('');

/**
 * Builds the next receipt number for a branch and day, e.g. `CENTRAL-20260904-0007`.
 *
 * The count is a hint, not the guarantee: uniqueness is enforced by the unique
 * index on `number`, and `createSale` retries when two tills happen to allocate
 * the same one at the same moment.
 */
export const nextSaleNumber = async (
  branchCode: string,
  branchId: string,
  soldAt: Date,
  session?: ClientSession,
): Promise<string> => {
  const dayStart = new Date(soldAt);
  dayStart.setHours(0, 0, 0, 0);

  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const soldToday = await SaleModel.countDocuments({
    branch: branchId,
    soldAt: { $gte: dayStart, $lt: dayEnd },
  })
    .session(session ?? null)
    .exec();

  const sequence = String(soldToday + 1).padStart(SEQUENCE_LENGTH, '0');

  return `${branchCode}-${datePart(soldAt)}-${sequence}`;
};
