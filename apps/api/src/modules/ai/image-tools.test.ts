import type { AuthenticatedUser } from '@hadiya/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../../test/database.js';
import { createTestBranch, signInAs } from '../../test/factories.js';
import * as contentService from '../content/content.service.js';
import { ImageAssetModel } from '../images/image-asset.model.js';
import * as imageService from '../images/image.service.js';
import { setImageProvider } from '../images/providers/image-provider.js';
import {
  createScriptedImageProvider,
  timeoutError,
  useTemporaryStorage,
  type TemporaryStorage,
} from '../images/test-support.js';
import { sendMessage } from './agent/agent.service.js';
import { setAiProvider } from './provider/index.js';
import { billzProduct, createRegistryWithBillz, createScriptedProvider } from './test-support.js';
import { createToolRegistry } from './tools/index.js';

/**
 * The assistant's route to an image.
 *
 * The tool runs through the same registry the agent uses, with a scripted image
 * model and a temporary storage directory — so validation, the service, storage
 * and the database are all real, and only the drawing is simulated.
 */

const app = createApp();
const CONVERSATION = '68b8f0000000000000000001';

let storage: TemporaryStorage;

beforeAll(async () => {
  await startTestDatabase();
  storage = await useTemporaryStorage();
});

afterAll(async () => {
  await storage.cleanup();
  await stopTestDatabase();
});

beforeEach(async () => {
  await clearTestDatabase();
  setImageProvider(createScriptedImageProvider());
});

afterEach(() => {
  setAiProvider(null);
  setImageProvider(null);
});

const signIn = async () => {
  const branch = await createTestBranch();

  return signInAs(app, 'manager', String(branch._id));
};

const seedContentItem = async (actor: AuthenticatedUser) => {
  const plan = await contentService.createPlan(actor, {
    title: 'Sentabr',
    platform: 'instagram',
    startDate: new Date('2026-09-07T00:00:00Z'),
    items: [
      {
        date: new Date('2026-09-13T00:00:00Z'),
        contentType: 'post',
        title: '7-kun: yangi soat',
        idea: 'Soatni ko‘rsatish',
        caption: 'Yangi soat keldi!',
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
  it('advertises the image tool', () => {
    const registry = createToolRegistry();

    expect(registry.definitions().map((definition) => definition.name)).toContain('generate_image');
    // Generating costs money and writes a row, so it is a mutating tool.
    expect(registry.get('generate_image')?.mutates).toBe(true);
    expect(registry.get('generate_image')?.requiresConfirmation ?? false).toBe(false);
  });

  it('tells the model what each aspect ratio is for', () => {
    const definition = createToolRegistry()
      .definitions()
      .find((entry) => entry.name === 'generate_image');

    const schema = JSON.stringify(definition?.parameters);
    expect(schema).toMatch(/Stories, Reels and TikTok/);
    expect(definition?.description).toMatch(/call get_products first/i);
  });
});

describe('generate_image', () => {
  it('generates, stores and reports back what a chat client needs', async () => {
    const { actor } = await signIn();

    const outcome = await createToolRegistry().execute(
      'generate_image',
      { prompt: 'A gold wristwatch on marble', aspectRatio: '1:1', count: 1 },
      { actor, conversationId: CONVERSATION },
    );

    expect(outcome.status).toBe('succeeded');
    expect(outcome.result.summary).toMatch(/1 image\(s\) generated at 1:1/);

    const data = outcome.result.data as {
      images: Array<{ id: string; url: string; prompt: string; status: string }>;
    };

    // Everything the future chat UI has to render, with nothing else to fetch.
    expect(data.images[0]).toMatchObject({
      status: 'completed',
      prompt: 'A gold wristwatch on marble',
      contentItemId: null,
    });
    expect(data.images[0]?.url).toBe(`/api/v1/images/${data.images[0]?.id}/file`);

    // The bytes never pass through the model.
    expect(JSON.stringify(outcome.result)).not.toMatch(/iVBORw0KGgo/);

    const stored = await ImageAssetModel.findOne().lean().exec();
    expect(String(stored?.conversation)).toBe(CONVERSATION);
  });

  it('passes the shape and style the model chose', async () => {
    const provider = createScriptedImageProvider();
    setImageProvider(provider);
    const { actor } = await signIn();

    await createToolRegistry().execute(
      'generate_image',
      { prompt: 'A shop window at dusk', aspectRatio: '9:16', style: 'lifestyle' },
      { actor, conversationId: CONVERSATION },
    );

    expect(provider.requests[0]).toMatchObject({ aspectRatio: '9:16', style: 'lifestyle' });
  });

  it('attaches to the day of a plan the model identified', async () => {
    const { actor } = await signIn();
    const { plan, item } = await seedContentItem(actor);

    const outcome = await createToolRegistry().execute(
      'generate_image',
      { prompt: 'A gold wristwatch', contentItemId: String(item._id) },
      { actor, conversationId: CONVERSATION },
    );

    expect(outcome.status).toBe('succeeded');
    expect(outcome.result.summary).toMatch(/attached to the content item/);
    expect(await imageService.listForContentItem(actor, String(item._id))).toHaveLength(1);

    // Nothing else about the plan moved.
    const after = await contentService.getPlanDetail(actor, String(plan._id));
    expect(after.items[0]).toMatchObject({
      title: '7-kun: yangi soat',
      caption: 'Yangi soat keldi!',
    });
  });

  it('generates several variations when the user asked for options', async () => {
    const { actor } = await signIn();

    const outcome = await createToolRegistry().execute(
      'generate_image',
      { prompt: 'Banner options', count: 3 },
      { actor, conversationId: CONVERSATION },
    );

    const data = outcome.result.data as { images: unknown[] };
    expect(data.images).toHaveLength(3);
  });

  it('rejects arguments that do not match the schema, before anything is paid for', async () => {
    const provider = createScriptedImageProvider();
    setImageProvider(provider);
    const { actor } = await signIn();
    const registry = createToolRegistry();

    for (const args of [
      { prompt: '' },
      { prompt: 'ok', aspectRatio: '21:9' },
      { prompt: 'ok', count: 50 },
      { prompt: 'ok', contentItemId: 'short' },
      {},
    ]) {
      const outcome = await registry.execute(args ? 'generate_image' : 'generate_image', args, {
        actor,
        conversationId: CONVERSATION,
      });

      expect(outcome.status).toBe('failed');
    }

    expect(provider.requests).toHaveLength(0);
    expect(await ImageAssetModel.countDocuments().exec()).toBe(0);
  });

  it('reports a provider failure as a failed call, and never leaks a credential', async () => {
    setImageProvider(createScriptedImageProvider({ failWith: timeoutError() }));
    const { actor } = await signIn();

    const outcome = await createToolRegistry().execute(
      'generate_image',
      { prompt: 'A gold wristwatch' },
      { actor, conversationId: CONVERSATION },
    );

    expect(outcome.status).toBe('failed');
    expect(outcome.result.summary).toMatch(/did not respond within/);
    expect(outcome.result.summary).not.toMatch(/sk-|apiKey/i);
    // The attempt is recorded rather than vanishing.
    expect(await ImageAssetModel.findOne().lean().exec()).toMatchObject({ status: 'failed' });
  });

  it('will not attach to another employee’s content item', async () => {
    const owner = await signIn();
    const stranger = await signIn();
    const { item } = await seedContentItem(owner.actor);
    const provider = createScriptedImageProvider();
    setImageProvider(provider);

    const outcome = await createToolRegistry().execute(
      'generate_image',
      { prompt: 'A gold wristwatch', contentItemId: String(item._id) },
      // The actor comes from the authenticated request, never from the model.
      { actor: stranger.actor, conversationId: CONVERSATION },
    );

    expect(outcome.status).toBe('failed');
    expect(outcome.result.summary).toMatch(/not found/i);
    expect(provider.requests).toHaveLength(0);
    expect(await ImageAssetModel.countDocuments().exec()).toBe(0);
  });
});

describe('through /ai/chat', () => {
  it('draws a picture for a post and says it did', async () => {
    const { actor } = await signIn();

    setAiProvider(
      createScriptedProvider([
        {
          content: '',
          toolCalls: [
            {
              callId: 'call-1',
              name: 'generate_image',
              arguments: {
                prompt: 'A gold wristwatch on a marble surface, soft daylight',
                aspectRatio: '1:1',
              },
            },
          ],
        },
        { content: 'Rasm tayyor. Galereyada ko‘rishingiz mumkin.' },
      ]),
    );

    const response = await sendMessage(actor, { message: 'Shu post uchun rasm yarat.' });

    expect(response.message.content).toMatch(/Rasm tayyor/);

    const stored = await ImageAssetModel.findOne().lean().exec();
    expect(stored).toMatchObject({ status: 'completed', aspectRatio: '1:1' });
    expect(stored?.metadata).toMatchObject({ source: 'assistant' });
  });

  it('reads the real product first, then draws it', async () => {
    const { actor } = await signIn();
    const registry = createRegistryWithBillz({
      searchProducts: async () => ({
        items: [billzProduct({ name: 'Gold wristwatch' })],
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
            arguments: { query: 'watch', limit: 5 },
          },
        ],
      },
      {
        content: '',
        toolCalls: [
          {
            callId: 'call-2',
            name: 'generate_image',
            arguments: {
              prompt: 'A Gold wristwatch displayed on a marble surface, studio lighting',
              aspectRatio: '4:5',
            },
          },
        ],
      },
      { content: 'Reklama rasmi tayyor.' },
    ]);

    setAiProvider(provider);

    await sendMessage(
      actor,
      { message: 'Hadiya yangi soat uchun Instagram reklama rasmi yarat.' },
      { registry },
    );

    // The prompt names the catalogue's own product rather than an invented one.
    const stored = await ImageAssetModel.findOne().lean().exec();
    expect(stored?.prompt).toContain('Gold wristwatch');
    expect(stored?.aspectRatio).toBe('4:5');
  });

  it('finds the day of the plan and attaches the image to it', async () => {
    const { actor } = await signIn();
    const { plan, item } = await seedContentItem(actor);

    setAiProvider(
      createScriptedProvider([
        {
          content: '',
          toolCalls: [
            {
              callId: 'call-1',
              name: 'get_content_plan',
              arguments: { planId: String(plan._id) },
            },
          ],
        },
        {
          content: '',
          toolCalls: [
            {
              callId: 'call-2',
              name: 'generate_image',
              arguments: {
                prompt: 'A gold wristwatch on marble',
                contentItemId: String(item._id),
              },
            },
          ],
        },
        { content: '7-kun uchun rasm qo‘shildi.' },
      ]),
    );

    await sendMessage(actor, { message: '7-kundagi content uchun rasm yarat.' });

    expect(await imageService.listForContentItem(actor, String(item._id))).toHaveLength(1);
    // Only that day was touched.
    const after = await contentService.getPlanDetail(actor, String(plan._id));
    expect(after.items).toHaveLength(1);
    expect(after.items[0]?.caption).toBe('Yangi soat keldi!');
  });

  it('tells the user when generation failed, rather than claiming success', async () => {
    setImageProvider(createScriptedImageProvider({ failWith: timeoutError() }));
    const { actor } = await signIn();

    setAiProvider(
      createScriptedProvider([
        {
          content: '',
          toolCalls: [
            { callId: 'call-1', name: 'generate_image', arguments: { prompt: 'A wristwatch' } },
          ],
        },
        { content: 'Kechirasiz, rasm yaratib bo‘lmadi.' },
      ]),
    );

    const response = await sendMessage(actor, { message: 'Rasm yarat.' });

    expect(response.message.content).toMatch(/bo‘lmadi/);
    expect(await ImageAssetModel.countDocuments({ status: 'completed' }).exec()).toBe(0);
  });
});
