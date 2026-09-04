import { afterEach, afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../../test/database.js';
import { createTestBranch, signInAs } from '../../test/factories.js';
import { setAiProvider } from '../ai/provider/index.js';
import { createScriptedProvider } from '../ai/test-support.js';
import * as memoryService from '../memory/memory.service.js';
import { ContentItemModel } from './content-item.model.js';
import { ContentPlanModel } from './content-plan.model.js';
import { loadContentPreferences } from './content-preferences.js';
import * as generationService from './content-generation.service.js';
import * as contentService from './content.service.js';

/**
 * Generation, with a scripted model.
 *
 * Every model reply here is written by the test, so the suite makes no paid
 * call and asserts on exactly what the engine does with a given answer — the
 * good ones, the malformed ones, and the ones that are almost right.
 */

const app = createApp();

beforeAll(startTestDatabase);
afterAll(stopTestDatabase);
beforeEach(clearTestDatabase);
afterEach(() => setAiProvider(null));

const NOW = new Date('2026-09-07T00:00:00Z');

const signIn = async () => {
  const branch = await createTestBranch();

  return signInAs(app, 'manager', String(branch._id));
};

/** A well-formed plan of `days` days, as a model would return it. */
const planReply = (days: number, prefix = 'Kun'): string =>
  JSON.stringify({
    title: `${days} kunlik Instagram plan`,
    description: 'Hadiya uchun content rejasi',
    items: Array.from({ length: days }, (_, index) => ({
      dayOffset: index,
      contentType: index % 2 === 0 ? 'post' : 'reel',
      title: `${prefix} ${index + 1}`,
      idea: `${prefix} ${index + 1} uchun g'oya`,
      caption: `${prefix} ${index + 1} uchun caption`,
      callToAction: "Do'konga tashrif buyuring",
      hashtags: ['hadiya', `kun${index + 1}`],
    })),
  });

const captionReply = (caption: string) =>
  JSON.stringify({
    caption,
    callToAction: 'Buyurtma bering',
    hashtags: ['hadiya', 'yangi'],
  });

describe('generating a plan', () => {
  it('turns a valid reply into a stored plan with real dates', async () => {
    const { actor } = await signIn();
    const provider = createScriptedProvider([{ content: planReply(7) }]);

    const result = await generationService.generatePlan(
      actor,
      { brief: 'Hadiya uchun 7 kunlik Instagram plan', days: 7 },
      { provider, now: NOW },
    );

    expect(result.plan).not.toBeNull();
    expect(result.items).toHaveLength(7);
    expect(result.attempts).toBe(1);

    const detail = await contentService.getPlanDetail(actor, String(result.plan?._id));
    expect(detail).toMatchObject({ platform: 'instagram', itemCount: 7, status: 'draft' });
    // The model numbers the days; the service works out which dates those are.
    expect(detail.items[0]?.date.toISOString()).toBe('2026-09-07T00:00:00.000Z');
    expect(detail.items[6]?.date.toISOString()).toBe('2026-09-13T00:00:00.000Z');
    expect(detail.items[0]).toMatchObject({
      contentType: 'post',
      caption: 'Kun 1 uchun caption',
      status: 'draft',
      hashtags: ['hadiya', 'kun1'],
    });
  });

  it('records what the plan was asked for, so it can be explained later', async () => {
    const { actor } = await signIn();
    const provider = createScriptedProvider([{ content: planReply(3) }]);

    const result = await generationService.generatePlan(
      actor,
      { brief: 'Ramazon kampaniyasi', days: 3, businessContext: 'Top product: Cola 1L' },
      { provider, now: NOW },
    );

    expect(result.plan?.metadata).toMatchObject({
      brief: 'Ramazon kampaniyasi',
      businessContext: 'Top product: Cola 1L',
      generatedBy: 'scripted-model',
    });
  });

  it('previews without storing when asked not to save', async () => {
    const { actor } = await signIn();
    const provider = createScriptedProvider([{ content: planReply(3) }]);

    const result = await generationService.generatePlan(
      actor,
      { brief: 'preview', days: 3, save: false },
      { provider, now: NOW },
    );

    expect(result.plan).toBeNull();
    expect(result.items).toHaveLength(3);
    expect(await ContentPlanModel.countDocuments().exec()).toBe(0);
  });

  it('keeps every day when the model numbers them from one', async () => {
    const { actor } = await signIn();
    // An off-by-one in the numbering still means three usable days; losing them
    // over it would be the wrong call.
    const provider = createScriptedProvider([
      {
        content: JSON.stringify({
          title: 'x',
          items: [1, 2, 3].map((day) => ({
            dayOffset: day,
            contentType: 'post',
            title: `Kun ${day}`,
            idea: 'g',
            caption: 'c',
            hashtags: [],
          })),
        }),
      },
    ]);

    const result = await generationService.generatePlan(
      actor,
      { brief: 'x', days: 3 },
      { provider, now: NOW },
    );

    expect(result.items).toHaveLength(3);
    expect(result.items.map((item) => item.title)).toEqual(['Kun 1', 'Kun 2', 'Kun 3']);
  });
});

describe('malformed model output', () => {
  it('retries once with the reason, and accepts the corrected reply', async () => {
    const { actor } = await signIn();
    const provider = createScriptedProvider([
      { content: "I'd be glad to help! Let me think about that." },
      { content: planReply(3) },
    ]);

    const result = await generationService.generatePlan(
      actor,
      { brief: 'x', days: 3 },
      { provider, now: NOW },
    );

    expect(result.attempts).toBe(2);
    expect(result.items).toHaveLength(3);

    // The retry carried the rejected reply and the reason, so it was a
    // correction rather than the same roll of the dice.
    const retry = provider.requests.at(-1);
    expect(retry?.messages).toHaveLength(4);
    expect(JSON.stringify(retry?.messages)).toMatch(/could not be used/i);
  });

  it('gives up cleanly when the model never returns usable JSON', async () => {
    const { actor } = await signIn();
    const provider = createScriptedProvider([{ content: 'Sorry, I cannot do that.' }]);

    await expect(
      generationService.generatePlan(actor, { brief: 'x', days: 3 }, { provider, now: NOW }),
    ).rejects.toThrow(/could not produce usable content/i);

    // The controlled failure is the point: nothing invalid was stored.
    expect(await ContentPlanModel.countDocuments().exec()).toBe(0);
    expect(await ContentItemModel.countDocuments().exec()).toBe(0);
  });

  it('refuses JSON that is the wrong shape, however confident it looks', async () => {
    const { actor } = await signIn();
    const provider = createScriptedProvider([
      // Every item is missing its caption.
      {
        content: JSON.stringify({
          title: 'x',
          items: [{ dayOffset: 0, contentType: 'post', title: 't', idea: 'i' }],
        }),
      },
    ]);

    await expect(
      generationService.generatePlan(actor, { brief: 'x', days: 1 }, { provider, now: NOW }),
    ).rejects.toThrow(/could not produce usable content/i);
    expect(await ContentPlanModel.countDocuments().exec()).toBe(0);
  });

  it('recovers a good plan from a fenced, chatty reply', async () => {
    const { actor } = await signIn();
    const provider = createScriptedProvider([
      { content: `Mana rejangiz:\n\`\`\`json\n${planReply(2)}\n\`\`\`\nOmad!` },
    ]);

    const result = await generationService.generatePlan(
      actor,
      { brief: 'x', days: 2 },
      { provider, now: NOW },
    );

    expect(result.attempts).toBe(1);
    expect(result.items).toHaveLength(2);
  });
});

describe('memory preferences', () => {
  it('reads only active memories, and puts them in the brief', async () => {
    const { actor } = await signIn();

    await memoryService.remember(actor, {
      type: 'preference',
      key: 'content_language',
      value: 'uzbek',
      source: 'user',
    });
    await memoryService.remember(actor, {
      type: 'preference',
      key: 'content_tone',
      value: 'professional',
      source: 'user',
    });
    // Guessed by the assistant and never confirmed: it must not shape anything.
    await memoryService.remember(actor, {
      type: 'preference',
      key: 'target_audience',
      value: 'teenagers',
      source: 'assistant',
      confidence: 0.2,
    });
    // Explicitly forgotten: it must not come back through the side door.
    await memoryService.remember(actor, {
      type: 'preference',
      key: 'brand_voice',
      value: 'shouty',
      source: 'user',
    });
    await memoryService.forget(actor, { type: 'preference', key: 'brand_voice' });

    const preferences = await loadContentPreferences(actor);

    expect(preferences).toMatchObject({
      language: 'uzbek',
      tone: 'professional',
      audience: null,
      brandVoice: null,
    });

    const provider = createScriptedProvider([{ content: planReply(2) }]);
    await generationService.generatePlan(actor, { brief: 'x', days: 2 }, { provider, now: NOW });

    const brief = JSON.stringify(provider.requests[0]?.messages);
    expect(brief).toMatch(/Write in uzbek/);
    expect(brief).toMatch(/Tone: professional/);
    expect(brief).not.toMatch(/teenagers/);
    expect(brief).not.toMatch(/shouty/);
  });

  it('ignores a stored tone outside the vocabulary rather than passing it on raw', async () => {
    const { actor } = await signIn();

    await memoryService.remember(actor, {
      type: 'preference',
      key: 'content_tone',
      value: 'zesty',
      source: 'user',
    });

    expect((await loadContentPreferences(actor)).tone).toBeNull();
  });

  it('keeps one employee’s preferences out of another’s content', async () => {
    const owner = await signIn();
    const stranger = await signIn();

    await memoryService.remember(owner.actor, {
      type: 'preference',
      key: 'content_language',
      value: 'russian',
      source: 'user',
    });

    expect((await loadContentPreferences(stranger.actor)).language).toBeNull();
  });
});

describe('business context', () => {
  it('passes the figures the caller gathered into the brief, and queries nothing itself', async () => {
    const { actor } = await signIn();
    const provider = createScriptedProvider([{ content: planReply(3) }]);

    await generationService.generatePlan(
      actor,
      {
        brief: 'Eng ko‘p sotilayotgan mahsulotlar asosida plan',
        days: 3,
        businessContext: 'Best sellers: Cola 1L ×120 (1 200 000 UZS), Choy ×80',
      },
      { provider, now: NOW },
    );

    const brief = JSON.stringify(provider.requests[0]?.messages);
    expect(brief).toMatch(/Cola 1L ×120/);
    expect(brief).toMatch(/refer to real products by name/i);
  });

  it('says nothing about the business when the caller supplied nothing', async () => {
    const { actor } = await signIn();
    const provider = createScriptedProvider([{ content: planReply(2) }]);

    await generationService.generatePlan(actor, { brief: 'x', days: 2 }, { provider, now: NOW });

    expect(JSON.stringify(provider.requests[0]?.messages)).not.toMatch(/Business data/);
  });
});

describe('captions and ideas', () => {
  it('writes a caption without storing anything', async () => {
    const { actor } = await signIn();
    const provider = createScriptedProvider([{ content: captionReply('Bugungi taklif!') }]);

    const result = await generationService.generateCaption(
      actor,
      { topic: 'Bugungi post', platform: 'instagram' },
      { provider },
    );

    expect(result.caption).toEqual({
      caption: 'Bugungi taklif!',
      callToAction: 'Buyurtma bering',
      hashtags: ['hadiya', 'yangi'],
    });
    expect(await ContentItemModel.countDocuments().exec()).toBe(0);
  });

  it('reworks a caption the user pasted in', async () => {
    const { actor } = await signIn();
    const provider = createScriptedProvider([{ content: captionReply('Qisqa.') }]);

    await generationService.generateCaption(
      actor,
      {
        topic: 'Yangi kolleksiya',
        existingCaption: 'Juda uzun caption '.repeat(20),
        instruction: 'qisqartir',
      },
      { provider },
    );

    const brief = JSON.stringify(provider.requests[0]?.messages);
    expect(brief).toMatch(/Rewrite the caption below/);
    expect(brief).toMatch(/What to change: qisqartir/);
  });

  it('returns a list of distinct ideas', async () => {
    const { actor } = await signIn();
    const provider = createScriptedProvider([
      {
        content: JSON.stringify({
          ideas: [
            {
              title: 'Ramazon sovg‘alari',
              idea: 'Sovg‘a to‘plamlarini ko‘rsatish',
              contentType: 'carousel',
              angle: 'Oila uchun sovg‘a',
              hashtags: ['ramazon'],
            },
            {
              title: 'Iftorlik menyusi',
              idea: 'Mahsulotlardan iftorlik',
              contentType: 'reel',
              angle: 'Retsept',
              hashtags: ['iftor'],
            },
          ],
        }),
      },
    ]);

    const result = await generationService.generateIdeas(
      actor,
      { topic: 'Ramazon', count: 2 },
      { provider },
    );

    expect(result.ideas).toHaveLength(2);
    expect(result.ideas[0]).toMatchObject({ contentType: 'carousel', title: 'Ramazon sovg‘alari' });
  });
});

describe('regenerating one item', () => {
  const seedItem = async (actor: Awaited<ReturnType<typeof signIn>>['actor']) => {
    const plan = await contentService.createPlan(actor, {
      title: 'Plan',
      platform: 'instagram',
      startDate: NOW,
      items: [
        {
          date: NOW,
          contentType: 'post',
          title: 'Asl sarlavha',
          idea: 'Asl g‘oya',
          caption: 'Asl caption, juda uzun.',
          callToAction: 'Asl CTA',
          hashtags: ['asl'],
          status: 'ready',
        },
      ],
    });
    const [item] = await contentService.listPlanItems(actor, String(plan._id));

    if (!item) {
      throw new Error('setup failed');
    }

    return item;
  };

  const rewriteReply = JSON.stringify({
    title: 'Yangi sarlavha',
    idea: 'Yangi g‘oya',
    contentType: 'reel',
    caption: 'Qisqa caption.',
    callToAction: 'Yangi CTA',
    hashtags: ['yangi'],
  });

  it('rewrites only the fields it was asked for', async () => {
    const { actor } = await signIn();
    const item = await seedItem(actor);
    const provider = createScriptedProvider([{ content: rewriteReply }]);

    const result = await generationService.regenerateItem(
      actor,
      { itemId: String(item._id), instruction: 'qisqartir', fields: ['caption'] },
      { provider },
    );

    expect(result.item.caption).toBe('Qisqa caption.');
    // Everything the person already approved survives.
    expect(result.item.title).toBe('Asl sarlavha');
    expect(result.item.idea).toBe('Asl g‘oya');
    expect(result.item.hashtags).toEqual(['asl']);
    expect(result.item.callToAction).toBe('Asl CTA');
    // The copy changed, so it is no longer the version that was approved.
    expect(result.item.status).toBe('draft');
  });

  it('refreshes just the hashtags', async () => {
    const { actor } = await signIn();
    const item = await seedItem(actor);
    const provider = createScriptedProvider([{ content: rewriteReply }]);

    const result = await generationService.regenerateItem(
      actor,
      { itemId: String(item._id), instruction: 'hashtaglarni yangila', fields: ['hashtags'] },
      { provider },
    );

    expect(result.item.hashtags).toEqual(['yangi']);
    expect(result.item.caption).toBe('Asl caption, juda uzun.');
  });

  it('rewrites the whole item when no fields are named', async () => {
    const { actor } = await signIn();
    const item = await seedItem(actor);
    const provider = createScriptedProvider([{ content: rewriteReply }]);

    const result = await generationService.regenerateItem(
      actor,
      { itemId: String(item._id), instruction: 'professionalroq qil' },
      { provider },
    );

    expect(result.item).toMatchObject({
      title: 'Yangi sarlavha',
      idea: 'Yangi g‘oya',
      caption: 'Qisqa caption.',
      hashtags: ['yangi'],
    });
  });

  it('shows the model the current item, so it can change one thing and keep the rest', async () => {
    const { actor } = await signIn();
    const item = await seedItem(actor);
    const provider = createScriptedProvider([{ content: rewriteReply }]);

    await generationService.regenerateItem(
      actor,
      { itemId: String(item._id), instruction: 'qisqartir' },
      { provider },
    );

    const brief = JSON.stringify(provider.requests[0]?.messages);
    expect(brief).toMatch(/Asl caption/);
    expect(brief).toMatch(/Change only what the instruction asks for/);
  });

  it('will not regenerate another employee’s item', async () => {
    const owner = await signIn();
    const stranger = await signIn();
    const item = await seedItem(owner.actor);
    const provider = createScriptedProvider([{ content: rewriteReply }]);

    await expect(
      generationService.regenerateItem(
        stranger.actor,
        { itemId: String(item._id), instruction: 'change it' },
        { provider },
      ),
    ).rejects.toThrow(/not found/i);
    // The model was never even asked.
    expect(provider.requests).toHaveLength(0);
  });
});
