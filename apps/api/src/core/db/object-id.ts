import { Types } from 'mongoose';

/**
 * Converts a validated id string into the type a document field expects.
 * Callers have already run the value through `objectIdSchema`, so an invalid
 * id here is a programming error, not user input.
 */
export const toObjectId = (id: string): Types.ObjectId => new Types.ObjectId(id);

export const toObjectIdOrNull = (id: string | null | undefined): Types.ObjectId | null =>
  id ? toObjectId(id) : null;
