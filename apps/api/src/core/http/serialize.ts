/**
 * Normalises a document tree for the wire: `_id` becomes a string `id` and the
 * internal version key is dropped.
 *
 * Lean reads bypass a schema's `toJSON` transform, so this runs in the response
 * layer instead — one place, applied to every payload, rather than a mapper per
 * module. Only plain objects and arrays are walked; `ObjectId`, `Date` and
 * `Buffer` instances are left alone for `JSON.stringify` to encode.
 */
const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const prototype: unknown = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
};

export const toApiPayload = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(toApiPayload);
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const result: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (key === '__v') {
      continue;
    }

    if (key === '_id') {
      result.id = entry === null || entry === undefined ? entry : String(entry);
      continue;
    }

    result[key] = toApiPayload(entry);
  }

  return result;
};
