import type { AuthenticatedUser } from '@hadiya/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../../test/database.js';
import {
  createTestBranch,
  signInAs,
} from '../../test/factories.js';
import { ContentItemModel } from '../content/content-item.model.js';
import { ContentPlanModel } from '../content/content-plan.model.js';
import * as contentService from '../content/content.service.js';
import * as memoryService from '../memory/memory.service.js';
import { sendMessage } from './agent/agent.service.js';
import { setAiProvider } from './provider/index.js';
import { billzProduct, createRegistryWithBillz, createScriptedProvider } from './test-support.js';
import { createToolRegistry } from './tools/index.js';

/**
 * The assistant's route to content.
 *
 * The tools run through the same registry the agent uses, with a scripted model
 * standing in for a paid one — so the validation, the services and the database
 * are all real and only the model's words are supplied by the test.
 *
 * Note the shape of a generating tool: the scripted provider answers *twice*
 * per turn where generation is involved, once for the agent's tool request and
 * once for the structured call the tool makes inside itself.
 */

const app = createApp();

beforeAll(startTestDatabase);
afterAll(stopTestDatabase);
beforeEach(clearTestDatabase);
afterEach(() => setAiProvider(null));

const CONVERSATION = '68b8f0000000000000000001';

const signIn = async () => {
  const branch = await createTestBranch();

  return signInAs(app, 'manager', String(branch._id));
};

const planReply = (days: number): string =>
  JSON.stringify({
    title: `${days} kunlik Instagram plan`,
    description: 'Hadiya uchun',
    items: Array.from({ length: days }, (_, index) => ({
      dayOffset: index,
      contentType: 'post',
      title: `Kun ${index + 1}`,
      idea: `Kun ${index + 1} g'oyasi`,
      caption: `Kun ${index + 1} caption`,
      callToAction: "Do'konga keling",
      hashtags: ['hadiya'],
    })),
  });

const seedPlan = async (actor: AuthenticatedUser) => {
  const plan = await contentService.createPlan(actor, {
    title: 'Mavjud plan',
    platform: 'instagram',
    startDate: new Date('2026-09-07T00:00:00Z'),
    items: [
      {
        date: new Date('2026-09-07T00:00:00Z'),
        contentType: 'post',
        title: 'Birinchi kun',
        idea: 'Asl g‘oya',
        caption: 'Asl caption',
        hashtags: ['asl'],
      },
    ],
  });
  const [item] = await contentService.listPlanItems(actor, String(plan._id));

  if (!item) {
    throw new Error('setup failed');
  }

  return { plan, item };
};

describe('the tool registry', () => {
  it('advertises every content tool to the model', () => {
    const names = createToolRegistry()
      .definitions()
      .map((definition) => definition.name);

    expect(names).toEqual(
      expect.arrayContaining([
        'create_content_plan',
        'get_content_plan',
        'list_content_plans',
        'update_content_plan',
        'delete_content_plan',
        'create_content_item',
        'update_content_item',
        'delete_content_item',
        'regenerate_content_item',
        'generate_caption',
        'generate_content_ideas',
      ]),
    );
  });

  it('marks the destructive tools as needing confirmation and the read-only ones as safe', () => {
    const registry = createToolRegistry();

    expect(registry.get('delete_content_plan')?.requiresConfirmation).toBe(true);
    expect(registry.get('delete_content_item')?.requiresConfirmation).toBe(true);
    expect(registry.get('create_content_plan')?.requiresConfirmation ?? false).toBe(false);
    // Generating a caption stores nothing, so it is not a write.
    expect(registry.get('generate_caption')?.mutates).toBe(false);
    expect(registry.get('list_content_plans')?.mutates).toBe(false);
  });
});

describe('create_content_plan', () => {
  it('generates, validates and saves a plan in one call', async () => {
    const { actor } = await signIn();
    setAiProvider(createScriptedProvider([{ content: planReply(7) }]));

    const outcome = await createToolRegistry().execute(
      'create_content_plan',
      { brief: 'Hadiya uchun 7 kunlik Instagram plan', days: 7, platform: 'instagram' },
      { actor, conversationId: CONVERSATION },
    );

    expect(outcome.status).toBe('succeeded');
    expect(outcome.result.summary).toMatch(/Saved a 7-day plan/);

    const stored = await ContentPlanModel.findOne().lean().exec();
    expect(stored).toMatchObject({ platform: 'instagram', itemCount: 7 });
    expect(await ContentItemModel.countDocuments().exec()).toBe(7);
    // The conversation it came from is kept as provenance.
    expect(String(stored?.conversation)).toBe(CONVERSATION);
  });

  it('stores the user’s own days verbatim, generating nothing', async () => {
    const { actor } = await signIn();
    // No provider is set: reaching a model here would throw.
    const outcome = await createToolRegistry().execute(
      'create_content_plan',
      {
        brief: 'Men aytgan kunlar',
        platform: 'telegram',
        items: [
          {
            date: '2026-09-07',
            contentType: 'announcement',
            title: 'Ochilish',
            idea: 'Yangi filial',
            caption: 'Ertaga ochamiz!',
          },
        ],
      },
      { actor, conversationId: CONVERSATION },
    );

    expect(outcome.status).toBe('succeeded');
    const item = await ContentItemModel.findOne().lean().exec();
    expect(item).toMatchObject({ caption: 'Ertaga ochamiz!', platform: 'telegram' });
  });

  it('reports a malformed model reply as a failed call, storing nothing', async () => {
    const { actor } = await signIn();
    setAiProvider(createScriptedProvider([{ content: 'I cannot do that.' }]));

    const outcome = await createToolRegistry().execute(
      'create_content_plan',
      { brief: 'Ramazon kampaniyasi', days: 3 },
      { actor, conversationId: CONVERSATION },
    );

    expect(outcome.status).toBe('failed');
    expect(outcome.result.summary).toMatch(/could not produce usable content/i);
    expect(await ContentPlanModel.countDocuments().exec()).toBe(0);
  });

  it('rejects arguments that do not match the schema before anything runs', async () => {
    const { actor } = await signIn();

    const outcome = await createToolRegistry().execute(
      'create_content_plan',
      { brief: 'Ramazon kampaniyasi', platform: 'myspace' },
      { actor, conversationId: CONVERSATION },
    );

    expect(outcome.status).toBe('failed');
    expect(await ContentPlanModel.countDocuments().exec()).toBe(0);
  });
});

describe('reading and editing through tools', () => {
  it('lists and fetches a plan with its days', async () => {
    const { actor } = await signIn();
    const { plan } = await seedPlan(actor);
    const registry = createToolRegistry();

    const list = await registry.execute(
      'list_content_plans',
      {},
      { actor, conversationId: CONVERSATION },
    );
    const detail = await registry.execute(
      'get_content_plan',
      { planId: String(plan._id) },
      { actor, conversationId: CONVERSATION },
    );

    expect(list.result.summary).toMatch(/Mavjud plan/);
    expect(detail.result.summary).toMatch(/Birinchi kun/);
    expect(detail.result.data).toMatchObject({ itemCount: 1 });
  });

  it('changes a plan’s own details without touching its days', async () => {
    const { actor } = await signIn();
    const { plan } = await seedPlan(actor);

    const outcome = await createToolRegistry().execute(
      'update_content_plan',
      { planId: String(plan._id), title: 'Yangi nom', status: 'active' },
      { actor, conversationId: CONVERSATION },
    );

    expect(outcome.status).toBe('succeeded');
    expect(await ContentPlanModel.findById(plan._id).lean().exec()).toMatchObject({
      title: 'Yangi nom',
      status: 'active',
      itemCount: 1,
    });
    expect(await ContentItemModel.countDocuments().exec()).toBe(1);
  });

  it('edits one field of one day and leaves the rest alone', async () => {
    const { actor } = await signIn();
    const { item } = await seedPlan(actor);

    const outcome = await createToolRegistry().execute(
      'update_content_item',
      { itemId: String(item._id), caption: 'Qisqaroq caption' },
      { actor, conversationId: CONVERSATION },
    );

    expect(outcome.status).toBe('succeeded');
    expect(await ContentItemModel.findById(item._id).lean().exec()).toMatchObject({
      caption: 'Qisqaroq caption',
      title: 'Birinchi kun',
      idea: 'Asl g‘oya',
      hashtags: ['asl'],
    });
  });

  it('rewrites only the named part of a day', async () => {
    const { actor } = await signIn();
    const { item } = await seedPlan(actor);

    setAiProvider(
      createScriptedProvider([
        {
          content: JSON.stringify({
            title: 'Yangi sarlavha',
            idea: 'Yangi g‘oya',
            caption: 'Professional caption.',
            callToAction: 'CTA',
            hashtags: ['yangi'],
          }),
        },
      ]),
    );

    const outcome = await createToolRegistry().execute(
      'regenerate_content_item',
      {
        itemId: String(item._id),
        instruction: "ko'proq professional qil",
        fields: ['caption'],
      },
      { actor, conversationId: CONVERSATION },
    );

    expect(outcome.status).toBe('succeeded');
    expect(await ContentItemModel.findById(item._id).lean().exec()).toMatchObject({
      caption: 'Professional caption.',
      title: 'Birinchi kun',
      hashtags: ['asl'],
    });
  });

  it('writes a caption without storing anything', async () => {
    const { actor } = await signIn();
    setAiProvider(
      createScriptedProvider([
        {
          content: JSON.stringify({
            caption: 'Bugungi post uchun caption.',
            callToAction: 'Buyurtma bering',
            hashtags: ['hadiya'],
          }),
        },
      ]),
    );

    const outcome = await createToolRegistry().execute(
      'generate_caption',
      { topic: 'Bugungi post' },
      { actor, conversationId: CONVERSATION },
    );

    expect(outcome.status).toBe('succeeded');
    expect(outcome.result.summary).toContain('Bugungi post uchun caption.');
    expect(outcome.result.summary).toContain('#hadiya');
    expect(await ContentItemModel.countDocuments().exec()).toBe(0);
  });

  it('offers ideas without storing anything', async () => {
    const { actor } = await signIn();
    setAiProvider(
      createScriptedProvider([
        {
          content: JSON.stringify({
            ideas: [
              {
                title: 'Ramazon sovg‘alari',
                idea: 'To‘plamlarni ko‘rsatish',
                contentType: 'carousel',
                angle: 'Oila',
                hashtags: ['ramazon'],
              },
            ],
          }),
        },
      ]),
    );

    const outcome = await createToolRegistry().execute(
      'generate_content_ideas',
      { topic: 'Ramazon', count: 1 },
      { actor, conversationId: CONVERSATION },
    );

    expect(outcome.status).toBe('succeeded');
    expect(outcome.result.summary).toMatch(/Ramazon sovg‘alari/);
    expect(await ContentPlanModel.countDocuments().exec()).toBe(0);
  });
});

describe('confirmation before deleting', () => {
  it('refuses to delete a plan until the user has agreed', async () => {
    const { actor } = await signIn();
    const { plan } = await seedPlan(actor);
    const registry = createToolRegistry();

    const proposed = await registry.execute(
      'delete_content_plan',
      { planId: String(plan._id) },
      { actor, conversationId: CONVERSATION },
    );

    expect(proposed.status).toBe('needs_confirmation');
    // The description names the real target, read from the database.
    expect(proposed.result.summary).toMatch(/permanently delete the plan "Mavjud plan" and its 1/);
    expect(proposed.result.summary).toMatch(/Do not assume they agreed/);
    expect(await ContentPlanModel.countDocuments().exec()).toBe(1);

    const confirmed = await registry.execute(
      'delete_content_plan',
      { planId: String(plan._id), confirm: true },
      { actor, conversationId: CONVERSATION },
    );

    expect(confirmed.status).toBe('succeeded');
    expect(await ContentPlanModel.countDocuments().exec()).toBe(0);
    expect(await ContentItemModel.countDocuments().exec()).toBe(0);
  });

  it('guards a single day the same way', async () => {
    const { actor } = await signIn();
    const { item } = await seedPlan(actor);
    const registry = createToolRegistry();

    const proposed = await registry.execute(
      'delete_content_item',
      { itemId: String(item._id) },
      { actor, conversationId: CONVERSATION },
    );

    expect(proposed.status).toBe('needs_confirmation');
    expect(await ContentItemModel.countDocuments().exec()).toBe(1);

    await registry.execute(
      'delete_content_item',
      { itemId: String(item._id), confirm: true },
      { actor, conversationId: CONVERSATION },
    );

    expect(await ContentItemModel.countDocuments().exec()).toBe(0);
  });

  it('does not describe a plan the asker cannot see', async () => {
    const owner = await signIn();
    const stranger = await signIn();
    const { plan } = await seedPlan(owner.actor);

    const outcome = await createToolRegistry().execute(
      'delete_content_plan',
      { planId: String(plan._id) },
      { actor: stranger.actor, conversationId: CONVERSATION },
    );

    // The confirmation step reads the target, so it fails the same way
    // everything else does — the title never leaks.
    expect(outcome.status).toBe('failed');
    expect(outcome.result.summary).toMatch(/not found/i);
    expect(outcome.result.summary).not.toMatch(/Mavjud plan/);
  });
});

describe('user isolation', () => {
  it('never reaches another employee’s plan through a tool', async () => {
    const owner = await signIn();
    const stranger = await signIn();
    const { plan, item } = await seedPlan(owner.actor);
    const registry = createToolRegistry();
    const context = { actor: stranger.actor, conversationId: CONVERSATION };

    const attempts = [
      await registry.execute('get_content_plan', { planId: String(plan._id) }, context),
      await registry.execute(
        'update_content_plan',
        { planId: String(plan._id), title: 'Hijacked' },
        context,
      ),
      await registry.execute(
        'update_content_item',
        { itemId: String(item._id), caption: 'Hijacked' },
        context,
      ),
      await registry.execute(
        'delete_content_plan',
        { planId: String(plan._id), confirm: true },
        context,
      ),
      await registry.execute(
        'delete_content_item',
        { itemId: String(item._id), confirm: true },
        context,
      ),
    ];

    for (const attempt of attempts) {
      expect(attempt.status).toBe('failed');
      expect(attempt.result.summary).toMatch(/not found/i);
    }

    const list = await registry.execute('list_content_plans', {}, context);
    expect(list.result.data).toMatchObject({ total: 0 });

    // Untouched.
    expect(await ContentPlanModel.findById(plan._id).lean().exec()).toMatchObject({
      title: 'Mavjud plan',
    });
    expect(await ContentItemModel.findById(item._id).lean().exec()).toMatchObject({
      caption: 'Asl caption',
    });
  });
});

describe('through /ai/chat', () => {
  it('plans, saves and reports back in one turn', async () => {
    const { actor } = await signIn();

    setAiProvider(
      createScriptedProvider([
        // 1. The agent asks for the tool.
        {
          content: '',
          toolCalls: [
            {
              callId: 'call-1',
              name: 'create_content_plan',
              arguments: { brief: 'Hadiya uchun 7 kunlik Instagram plan', days: 7 },
            },
          ],
        },
        // 2. The structured call the tool makes inside itself.
        { content: planReply(7) },
        // 3. The agent's written answer.
        { content: '7 kunlik plan saqlandi. Har kun uchun caption va hashtag tayyor.' },
      ]),
    );

    const response = await sendMessage(actor, {
      message: 'Hadiya uchun 7 kunlik Instagram content plan tuzib saqla.',
    });

    expect(response.message.content).toMatch(/saqlandi/);

    // The whole path is real: a plan and its days are in the database.
    const stored = await ContentPlanModel.findOne().lean().exec();
    expect(stored).toMatchObject({ itemCount: 7, platform: 'instagram' });
    expect(await ContentItemModel.countDocuments().exec()).toBe(7);
  });

  it('reads the shop’s own products first, then writes about them', async () => {
    const { actor } = await signIn();
    const registry = createRegistryWithBillz({
      searchProducts: async () => ({
        items: [billzProduct({ name: 'Cola 1L' })],
        total: 1,
      }),
    });

    const provider = createScriptedProvider([
      {
        content: '',
        toolCalls: [
          {
            callId: 'call-1',
            name: 'billz_search_products',
            arguments: { query: 'Cola', limit: 5 },
          },
        ],
      },
      {
        content: '',
        toolCalls: [
          {
            callId: 'call-2',
            name: 'create_content_plan',
            arguments: {
              brief: 'Eng ko‘p sotilayotgan mahsulotlar asosida plan',
              days: 3,
              businessContext: 'Cola 1L — 12 000 UZS',
            },
          },
        ],
      },
      { content: planReply(3) },
      { content: '3 kunlik plan tayyor.' },
    ]);

    setAiProvider(provider);

    await sendMessage(
      actor,
      { message: 'Eng ko‘p sotilayotgan mahsulotlar asosida 3 kunlik plan tuz.' },
      { registry },
    );

    // The product Billz returned reached the generator's brief — it was never
    // read by the content engine itself, and was never invented by the model.
    const briefs = provider.requests.map((entry) => JSON.stringify(entry.messages));
    expect(briefs.some((brief) => brief.includes('Cola 1L'))).toBe(true);
    expect(await ContentPlanModel.countDocuments().exec()).toBe(1);
  });

  it('applies a remembered preference to what it writes', async () => {
    const { actor } = await signIn();

    await memoryService.remember(actor, {
      type: 'preference',
      key: 'content_language',
      value: 'uzbek',
      source: 'user',
    });

    const provider = createScriptedProvider([
      {
        content: '',
        toolCalls: [
          { callId: 'call-1', name: 'generate_caption', arguments: { topic: 'Bugungi post' } },
        ],
      },
      {
        content: JSON.stringify({
          caption: 'Bugungi taklif!',
          callToAction: 'Keling',
          hashtags: ['hadiya'],
        }),
      },
      { content: 'Mana caption.' },
    ]);

    setAiProvider(provider);

    await sendMessage(actor, { message: 'Bugungi post uchun caption yoz.' });

    // The second request is the structured one the tool made; the preference is
    // in its brief.
    expect(JSON.stringify(provider.requests[1]?.messages)).toMatch(/Write in uzbek/);
  });

  it('proposes a deletion rather than carrying it out', async () => {
    const { actor } = await signIn();
    const { plan } = await seedPlan(actor);

    setAiProvider(
      createScriptedProvider([
        {
          content: '',
          toolCalls: [
            {
              callId: 'call-1',
              name: 'delete_content_plan',
              arguments: { planId: String(plan._id) },
            },
          ],
        },
        { content: '"Mavjud plan" va uning 1 ta kunini o‘chirmoqchimisiz?' },
      ]),
    );

    const response = await sendMessage(actor, { message: 'Eski planni o‘chir.' });

    expect(response.message.content).toMatch(/o‘chirmoqchimisiz/);
    // Nothing was destroyed on the model's own reading of the sentence.
    expect(await ContentPlanModel.countDocuments().exec()).toBe(1);
  });
});
