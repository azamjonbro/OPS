import type { z } from 'zod';

/**
 * Turning a model's reply into a validated object.
 *
 * A language model asked for JSON usually returns JSON — and sometimes returns
 * JSON wrapped in a code fence, or preceded by "Here is your plan:", or with a
 * trailing comma a human would not have written. None of that is the model
 * failing at the task; it is the model failing at the envelope, and throwing
 * away a good plan over a stray backtick would be the wrong trade.
 *
 * So recovery here is deliberately narrow: it removes packaging and fixes
 * syntax that has exactly one possible meaning. It never guesses at content,
 * never fills in a missing field, and never coerces a value into passing. What
 * survives is then validated against a Zod schema, and anything that fails is
 * reported as a failure — the caller's job is to decide whether to re-ask the
 * model or to give up, and nothing invalid ever reaches the database.
 */

export type StructuredParseResult<TData> =
  | { ok: true; data: TData }
  | { ok: false; reason: 'unparseable' | 'invalid'; message: string; issues?: string[] };

/** Strips a ```json … ``` fence, which is the most common wrapper by far. */
const stripCodeFence = (text: string): string => {
  const fenced = /^\s*```(?:json|JSON)?\s*\n([\s\S]*?)\n?\s*```\s*$/.exec(text);

  return fenced?.[1] ?? text;
};

/**
 * Pulls the first complete JSON value out of surrounding prose.
 *
 * Scans for a `{` or `[` and walks forward counting depth, respecting strings
 * and escapes so a brace inside a caption does not end the object early. The
 * first balanced value wins: a reply with commentary on both sides yields the
 * object between them.
 */
const extractFirstJsonValue = (text: string): string | null => {
  const start = text.search(/[{[]/);

  if (start === -1) {
    return null;
  }

  const opening = text[start];
  const closing = opening === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const character = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (character === '\\') {
      escaped = true;
      continue;
    }

    if (character === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (character === opening) {
      depth += 1;
    } else if (character === closing) {
      depth -= 1;

      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
};

/**
 * Removes a comma before a closing brace or bracket.
 *
 * Unambiguous — a trailing comma has no other reading — and applied only
 * outside strings, so a caption ending in ", " is untouched.
 */
const dropTrailingCommas = (text: string): string => {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? '';

    if (escaped) {
      escaped = false;
      result += character;
      continue;
    }

    if (character === '\\' && inString) {
      escaped = true;
      result += character;
      continue;
    }

    if (character === '"') {
      inString = !inString;
      result += character;
      continue;
    }

    if (!inString && character === ',') {
      const next = text.slice(index + 1).match(/^\s*([}\]])/);

      if (next) {
        // Skip the comma; the whitespace and the bracket are emitted next.
        continue;
      }
    }

    result += character;
  }

  return result;
};

/**
 * Reads JSON out of whatever the model actually said, or returns `null`.
 *
 * Each step is tried in turn and the first that parses wins, so the cheap path
 * — the model returned clean JSON — costs one `JSON.parse`.
 */
export const parseLooseJson = (text: string): unknown | null => {
  const candidates = [text, stripCodeFence(text)];
  const extracted = extractFirstJsonValue(stripCodeFence(text));

  if (extracted) {
    candidates.push(extracted, dropTrailingCommas(extracted));
  }

  for (const candidate of candidates) {
    const trimmed = candidate.trim();

    if (trimmed.length === 0) {
      continue;
    }

    try {
      return JSON.parse(trimmed);
    } catch {
      // Try the next, more aggressive, reading.
    }
  }

  return null;
};

/** Zod issues as short lines a model can act on. */
export const describeIssues = (error: z.ZodError): string[] =>
  error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);

/**
 * Parse, then validate. The two failures are reported separately because they
 * call for different corrections: unparseable means "send me JSON", invalid
 * means "this field is wrong".
 */
export const parseStructured = <TSchema extends z.ZodType>(
  text: string,
  schema: TSchema,
): StructuredParseResult<z.output<TSchema>> => {
  const parsed = parseLooseJson(text);

  if (parsed === null) {
    return {
      ok: false,
      reason: 'unparseable',
      message: 'The model did not return JSON.',
    };
  }

  const result = schema.safeParse(parsed);

  if (!result.success) {
    const issues = describeIssues(result.error);

    return {
      ok: false,
      reason: 'invalid',
      message: `The model returned JSON that does not match the required shape: ${issues.join('; ')}`,
      issues,
    };
  }

  return { ok: true, data: result.data };
};
