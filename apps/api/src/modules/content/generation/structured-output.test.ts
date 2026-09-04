import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { generatedPlanSchema, hashtagsSchema, contentTypeSchema } from './content-schemas.js';
import { parseLooseJson, parseStructured } from './structured-output.js';

/**
 * The envelope, not the content.
 *
 * These assert exactly where leniency stops: packaging and unambiguous syntax
 * are repaired, and anything that would require guessing at meaning is refused.
 */

describe('recovering JSON from a reply', () => {
  it('reads clean JSON', () => {
    expect(parseLooseJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('unwraps a markdown fence', () => {
    expect(parseLooseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseLooseJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('ignores prose on either side', () => {
    expect(parseLooseJson('Here is your plan:\n{"a":1}\nHope that helps!')).toEqual({ a: 1 });
  });

  it('drops a trailing comma', () => {
    expect(parseLooseJson('{"a":1,"b":[1,2,],}')).toEqual({ a: 1, b: [1, 2] });
  });

  it('is not fooled by braces inside a caption', () => {
    const text = 'Text before {"caption":"use code {SALE} today","n":2} and after';

    expect(parseLooseJson(text)).toEqual({ caption: 'use code {SALE} today', n: 2 });
  });

  it('leaves a comma inside a string alone', () => {
    expect(parseLooseJson('{"caption":"one, two, three"}')).toEqual({
      caption: 'one, two, three',
    });
  });

  it('reads a top-level array', () => {
    expect(parseLooseJson('[{"a":1}]')).toEqual([{ a: 1 }]);
  });

  it('gives up on a reply with no JSON in it', () => {
    expect(parseLooseJson("I'm sorry, I can't help with that.")).toBeNull();
    expect(parseLooseJson('')).toBeNull();
    // An unterminated object is not repaired: completing it would be a guess.
    expect(parseLooseJson('{"a":1')).toBeNull();
  });
});

describe('validating against a schema', () => {
  const schema = z.object({ name: z.string(), count: z.number() });

  it('accepts what matches', () => {
    const result = parseStructured('{"name":"a","count":2}', schema);

    expect(result).toEqual({ ok: true, data: { name: 'a', count: 2 } });
  });

  it('separates “not JSON” from “wrong shape”, because the fixes differ', () => {
    const unparseable = parseStructured('no json here', schema);
    const invalid = parseStructured('{"name":"a"}', schema);

    expect(unparseable).toMatchObject({ ok: false, reason: 'unparseable' });
    expect(invalid).toMatchObject({ ok: false, reason: 'invalid' });
    expect(invalid.ok === false && invalid.issues).toEqual([expect.stringContaining('count')]);
  });
});

describe('the content shapes', () => {
  it('normalises hashtags however the model wrote them', () => {
    // Spacing and punctuation go; the casing stays, because #YangiMahsulot is
    // readable. #SALE is dropped as a duplicate of sale, which every platform
    // would treat as the same tag.
    expect(hashtagsSchema.parse(['#Yangi Mahsulot', 'sale', '#SALE', '  ', '#chegirma!'])).toEqual([
      'YangiMahsulot',
      'sale',
      'chegirma',
    ]);
  });

  it('accepts hashtags given as one string', () => {
    expect(hashtagsSchema.parse('#sale #yangi')).toEqual(['sale', 'yangi']);
  });

  it('accepts a content type in any casing and falls back to “other”', () => {
    expect(contentTypeSchema.parse('Reel')).toBe('reel');
    expect(contentTypeSchema.parse('  CAROUSEL ')).toBe('carousel');
    // Still usable content — the item's own words carry the meaning.
    expect(contentTypeSchema.parse('livestream')).toBe('other');
    expect(contentTypeSchema.parse(42)).toBe('other');
  });

  it('accepts a whole plan the model wrote', () => {
    const reply = `\`\`\`json
{
  "title": "7 kunlik Instagram plan",
  "description": "Hadiya uchun",
  "items": [
    {
      "dayOffset": "0",
      "contentType": "Post",
      "title": "Yangi kolleksiya",
      "idea": "Do'kondagi yangi mahsulotlarni ko'rsatish",
      "caption": "Yangi kolleksiya keldi!",
      "callToAction": "Do'konga tashrif buyuring",
      "hashtags": ["#Yangi", "hadiya"]
    }
  ],
}
\`\`\``;

    const result = parseStructured(reply, generatedPlanSchema);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.items[0]).toMatchObject({
      // Coerced from a string, because "0" has one possible reading.
      dayOffset: 0,
      contentType: 'post',
      hashtags: ['Yangi', 'hadiya'],
    });
  });

  it('refuses a plan with an item that has no caption', () => {
    const result = parseStructured(
      '{"title":"x","items":[{"dayOffset":0,"contentType":"post","title":"t","idea":"i"}]}',
      generatedPlanSchema,
    );

    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('refuses a plan with no items at all', () => {
    expect(parseStructured('{"title":"x","items":[]}', generatedPlanSchema)).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
  });
});
