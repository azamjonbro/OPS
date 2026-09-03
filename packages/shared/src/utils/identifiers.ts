const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

/** Matches the string form of a MongoDB ObjectId without importing a driver. */
export const isObjectIdString = (value: unknown): value is string =>
  typeof value === 'string' && OBJECT_ID_PATTERN.test(value);

export const OBJECT_ID_REGEX = OBJECT_ID_PATTERN;
