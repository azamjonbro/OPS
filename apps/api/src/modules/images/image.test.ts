import type { AuthenticatedUser } from '@hadiya/shared';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { HTTP_STATUS } from '../../core/http/http-status.js';
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../../test/database.js';
import { createTestBranch, signInAs } from '../../test/factories.js';
import * as contentService from '../content/content.service.js';
import { ImageAssetModel } from './image-asset.model.js';
import * as imageService from './image.service.js';
import { setImageProvider } from './providers/image-provider.js';
import { getStorageProvider } from './storage/index.js';
import {
  createScriptedImageProvider,
  PNG_PIXEL,
  timeoutError,
  useTemporaryStorage,
  type TemporaryStorage,
} from './test-support.js';

/**
 * Image generation end to end, with a scripted provider and a temporary
 * storage directory.
 *
 * No paid call is made: the service is written against the provider interface,
 * so every answer here — including the failures — is written by the test.
 */

const app = createApp();
const url = '/api/v1/images';

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

afterEach(() => setImageProvider(null));

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
        date: new Date('2026-09-07T00:00:00Z'),
        contentType: 'post',
        title: 'Yangi soat',
        idea: 'Soatni ko‘rsatish',
      },
    ],
  });
  const [item] = await contentService.listPlanItems(actor, String(plan._id));

  if (!item) {
    throw new Error('setup failed');
  }

  return { plan, item };
};

describe(`POST ${url}/generate`, () => {
  it('generates an image, stores the bytes and completes the row', async () => {
    const { authorization } = await signIn();

    const response = await request(app)
      .post(`${url}/generate`)
      .set('Authorization', authorization)
      .send({ prompt: 'A wristwatch on a marble surface', aspectRatio: '1:1' });

    expect(response.status).toBe(HTTP_STATUS.CREATED);
    expect(response.body.data.images).toHaveLength(1);

    const image = response.body.data.images[0];
    expect(image).toMatchObject({
      status: 'completed',
      provider: 'scripted',
      aspectRatio: '1:1',
      contentType: 'image/png',
      prompt: 'A wristwatch on a marble surface',
    });
    // The URL is Hadiya's own authenticated path, never a provider link.
    expect(image.url).toBe(`/api/v1/images/${image.id}/file`);
    expect(image.storageKey).toMatch(/^images\/[a-f0-9]{24}\/[a-f0-9]{24}\.png$/);

    // And the bytes really are in storage.
    const stored = await getStorageProvider().read(image.storageKey);
    expect(stored.data.equals(PNG_PIXEL)).toBe(true);
  });

  it('passes the requested shape and style through to the provider', async () => {
    const provider = createScriptedImageProvider();
    setImageProvider(provider);
    const { authorization } = await signIn();

    await request(app)
      .post(`${url}/generate`)
      .set('Authorization', authorization)
      .send({ prompt: 'A shop window', aspectRatio: '9:16', style: 'lifestyle', quality: 'high' });

    expect(provider.requests[0]).toMatchObject({
      prompt: 'A shop window',
      aspectRatio: '9:16',
      style: 'lifestyle',
      quality: 'high',
      count: 1,
    });
  });

  it('keeps the revised prompt the model reports', async () => {
    setImageProvider(createScriptedImageProvider({ revisedPrompt: 'A gold wristwatch, studio lit' }));
    const { actor } = await signIn();

    const result = await imageService.generateImages(actor, { prompt: 'a watch' });

    expect(result.images[0]?.revisedPrompt).toBe('A gold wristwatch, studio lit');
  });

  it('generates several variations at once', async () => {
    const { authorization } = await signIn();

    const response = await request(app)
      .post(`${url}/generate`)
      .set('Authorization', authorization)
      .send({ prompt: 'Three options for a banner', count: 3 });

    expect(response.body.data.images).toHaveLength(3);
    expect(response.body.data.note).toBeNull();
    expect(await ImageAssetModel.countDocuments({ status: 'completed' }).exec()).toBe(3);
    // Each gets its own key, so one cannot overwrite another.
    const keys = new Set(
      response.body.data.images.map((image: { storageKey: string }) => image.storageKey),
    );
    expect(keys.size).toBe(3);
  });

  it('says so when the provider produces fewer than were asked for', async () => {
    setImageProvider(createScriptedImageProvider({ maxImagesPerRequest: 1 }));
    const { actor } = await signIn();

    const result = await imageService.generateImages(actor, { prompt: 'four please', count: 4 });

    expect(result.images).toHaveLength(1);
    expect(result.note).toMatch(/1 of 4 images were produced/);
  });

  it('marks the rows failed and reports a 503 when the provider fails', async () => {
    setImageProvider(createScriptedImageProvider({ failWith: timeoutError() }));
    const { authorization } = await signIn();

    const response = await request(app)
      .post(`${url}/generate`)
      .set('Authorization', authorization)
      .send({ prompt: 'A wristwatch' });

    expect(response.status).toBe(HTTP_STATUS.SERVICE_UNAVAILABLE);
    expect(response.body.error.message).toMatch(/did not respond within/);

    // The attempt is visible rather than vanishing, and nothing claims to be
    // finished.
    const rows = await ImageAssetModel.find().lean().exec();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'failed', storageKey: null });
    expect(rows[0]?.failureReason).toMatch(/did not respond within/);
  });

  it('reports a rate limit as a 429 rather than a generic outage', async () => {
    const { AiProviderError } = await import('../ai/provider/ai-error.js');
    setImageProvider(
      createScriptedImageProvider({
        failWith: new AiProviderError('rate_limited', 'the provider is rate limiting this key'),
      }),
    );
    const { authorization } = await signIn();

    const response = await request(app)
      .post(`${url}/generate`)
      .set('Authorization', authorization)
      .send({ prompt: 'A wristwatch' });

    expect(response.status).toBe(HTTP_STATUS.TOO_MANY_REQUESTS);
  });

  it('refuses invalid arguments before reaching the provider', async () => {
    const provider = createScriptedImageProvider();
    setImageProvider(provider);
    const { authorization } = await signIn();

    for (const body of [
      { prompt: '' },
      { prompt: 'ok', aspectRatio: '21:9' },
      { prompt: 'ok', count: 99 },
      { prompt: 'ok', style: 'cyberpunk' },
      { prompt: 'ok', contentItemId: 'not-an-id' },
      { prompt: 'a'.repeat(2_000) },
    ]) {
      const response = await request(app)
        .post(`${url}/generate`)
        .set('Authorization', authorization)
        .send(body);

      expect(response.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    }

    expect(provider.requests).toHaveLength(0);
    expect(await ImageAssetModel.countDocuments().exec()).toBe(0);
  });

  it('has no way to name where the bytes go', async () => {
    const { authorization } = await signIn();

    const response = await request(app)
      .post(`${url}/generate`)
      .set('Authorization', authorization)
      .send({
        prompt: 'A wristwatch',
        // None of these are in the schema; a strict parse drops them, and the
        // key is built from ids either way.
        storageKey: '../../etc/passwd.png',
        url: 'https://evil.example.com/x.png',
        path: '/etc/passwd',
      });

    expect(response.status).toBe(HTTP_STATUS.CREATED);
    expect(response.body.data.images[0].storageKey).toMatch(
      /^images\/[a-f0-9]{24}\/[a-f0-9]{24}\.png$/,
    );
  });

  it('refuses when no image model is configured, without writing a row', async () => {
    // The real stand-in, so this asserts what an unconfigured deployment does.
    const { createUnconfiguredImageProvider } = await import('./providers/index.js');
    setImageProvider(createUnconfiguredImageProvider('set OPENAI_API_KEY'));
    const { authorization } = await signIn();

    const response = await request(app)
      .post(`${url}/generate`)
      .set('Authorization', authorization)
      .send({ prompt: 'A wristwatch' });

    expect(response.status).toBe(HTTP_STATUS.SERVICE_UNAVAILABLE);
    expect(response.body.error.message).toMatch(/not available/i);
    // Nothing was written, so no row claims to be generating for ever.
    expect(await ImageAssetModel.countDocuments().exec()).toBe(0);
  });

  it('maps an unexpected provider throw to a 503, not a 500', async () => {
    setImageProvider(createScriptedImageProvider({ failWith: new Error('socket exploded') }));
    const { authorization } = await signIn();

    const response = await request(app)
      .post(`${url}/generate`)
      .set('Authorization', authorization)
      .send({ prompt: 'A wristwatch' });

    expect(response.status).toBe(HTTP_STATUS.SERVICE_UNAVAILABLE);
    expect(await ImageAssetModel.findOne().lean().exec()).toMatchObject({ status: 'failed' });
  });
});

describe('content association', () => {
  it('attaches an image to a day of a plan at generation time', async () => {
    const { actor, authorization } = await signIn();
    const { item } = await seedContentItem(actor);

    const response = await request(app)
      .post(`${url}/generate`)
      .set('Authorization', authorization)
      .send({ prompt: 'A wristwatch', contentItemId: String(item._id) });

    expect(response.status).toBe(HTTP_STATUS.CREATED);
    expect(response.body.data.images[0].contentItem).toBe(String(item._id));

    const attached = await imageService.listForContentItem(actor, String(item._id));
    expect(attached).toHaveLength(1);
  });

  it('attaches and detaches afterwards', async () => {
    const { actor, authorization } = await signIn();
    const { item } = await seedContentItem(actor);
    const generated = await imageService.generateImages(actor, { prompt: 'A wristwatch' });
    const imageId = String(generated.images[0]?._id);

    const attached = await request(app)
      .post(`${url}/${imageId}/attach`)
      .set('Authorization', authorization)
      .send({ contentItemId: String(item._id) });

    expect(attached.status).toBe(HTTP_STATUS.OK);
    expect(attached.body.data.contentItem).toBe(String(item._id));

    const detached = await request(app)
      .post(`${url}/${imageId}/attach`)
      .set('Authorization', authorization)
      .send({ contentItemId: null });

    expect(detached.body.data.contentItem).toBeNull();
  });

  it('changes nothing else about the plan', async () => {
    const { actor, authorization } = await signIn();
    const { plan, item } = await seedContentItem(actor);

    await request(app)
      .post(`${url}/generate`)
      .set('Authorization', authorization)
      .send({ prompt: 'A wristwatch', contentItemId: String(item._id) });

    const after = await contentService.getPlanDetail(actor, String(plan._id));
    expect(after).toMatchObject({ title: 'Sentabr', itemCount: 1 });
    expect(after.items[0]).toMatchObject({ title: 'Yangi soat', idea: 'Soatni ko‘rsatish' });
  });

  it('holds several images for one day', async () => {
    const { actor } = await signIn();
    const { item } = await seedContentItem(actor);

    await imageService.generateImages(actor, {
      prompt: 'Option A',
      contentItemId: String(item._id),
    });
    await imageService.generateImages(actor, {
      prompt: 'Option B',
      contentItemId: String(item._id),
    });

    expect(await imageService.listForContentItem(actor, String(item._id))).toHaveLength(2);
  });

  it('refuses to attach to another employee’s content item', async () => {
    const owner = await signIn();
    const stranger = await signIn();
    const { item } = await seedContentItem(owner.actor);
    const provider = createScriptedImageProvider();
    setImageProvider(provider);

    const response = await request(app)
      .post(`${url}/generate`)
      .set('Authorization', stranger.authorization)
      .send({ prompt: 'A wristwatch', contentItemId: String(item._id) });

    expect(response.status).toBe(HTTP_STATUS.NOT_FOUND);
    // Ownership is checked before anything is paid for.
    expect(provider.requests).toHaveLength(0);
    expect(await ImageAssetModel.countDocuments().exec()).toBe(0);
  });
});

describe('reading and deleting', () => {
  it('lists a user’s images newest first, with paging and filters', async () => {
    const { actor, authorization } = await signIn();
    const { item } = await seedContentItem(actor);

    await imageService.generateImages(actor, { prompt: 'First' });
    await imageService.generateImages(actor, {
      prompt: 'Second',
      contentItemId: String(item._id),
    });

    const all = await request(app).get(url).set('Authorization', authorization);
    const attached = await request(app)
      .get(url)
      .query({ contentItemId: String(item._id) })
      .set('Authorization', authorization);
    const unattached = await request(app)
      .get(url)
      .query({ unattached: 'true' })
      .set('Authorization', authorization);
    const paged = await request(app)
      .get(url)
      .query({ pageSize: 1 })
      .set('Authorization', authorization);
    const searched = await request(app)
      .get(url)
      .query({ search: 'Second' })
      .set('Authorization', authorization);

    expect(all.body.data.items.map((image: { prompt: string }) => image.prompt)).toEqual([
      'Second',
      'First',
    ]);
    expect(attached.body.data.items).toHaveLength(1);
    expect(unattached.body.data.items[0].prompt).toBe('First');
    expect(paged.body.data.pagination).toMatchObject({ total: 2, totalPages: 2, hasNext: true });
    expect(searched.body.data.items).toHaveLength(1);
  });

  it('serves the bytes to their owner, with the right content type', async () => {
    const { actor, authorization } = await signIn();
    const generated = await imageService.generateImages(actor, { prompt: 'A wristwatch' });
    const imageId = String(generated.images[0]?._id);

    const response = await request(app)
      .get(`${url}/${imageId}/file`)
      .set('Authorization', authorization);

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.headers['content-type']).toBe('image/png');
    // Never a shared cache: one user's image must not be held for another.
    expect(response.headers['cache-control']).toMatch(/private/);
    expect(Buffer.from(response.body).equals(PNG_PIXEL)).toBe(true);
  });

  it('has no file for an asset that failed', async () => {
    setImageProvider(createScriptedImageProvider({ failWith: timeoutError() }));
    const { actor, authorization } = await signIn();

    await imageService.generateImages(actor, { prompt: 'A wristwatch' }).catch(() => null);
    const failed = await ImageAssetModel.findOne().lean().exec();

    const response = await request(app)
      .get(`${url}/${String(failed?._id)}/file`)
      .set('Authorization', authorization);

    expect(response.status).toBe(HTTP_STATUS.NOT_FOUND);
  });

  it('deletes the row and the file behind it', async () => {
    const { actor, authorization } = await signIn();
    const generated = await imageService.generateImages(actor, { prompt: 'A wristwatch' });
    const image = generated.images[0];
    const storageKey = String(image?.storageKey);

    expect(await getStorageProvider().exists(storageKey)).toBe(true);

    const response = await request(app)
      .delete(`${url}/${String(image?._id)}`)
      .set('Authorization', authorization);

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data).toEqual({ deleted: 1 });
    expect(await ImageAssetModel.countDocuments().exec()).toBe(0);
    expect(await getStorageProvider().exists(storageKey)).toBe(false);
  });

  it('reports a second deletion as missing', async () => {
    const { actor, authorization } = await signIn();
    const generated = await imageService.generateImages(actor, { prompt: 'A wristwatch' });
    const imageId = String(generated.images[0]?._id);

    await request(app).delete(`${url}/${imageId}`).set('Authorization', authorization);
    const second = await request(app).delete(`${url}/${imageId}`).set('Authorization', authorization);

    expect(second.status).toBe(HTTP_STATUS.NOT_FOUND);
  });
});

describe('user isolation', () => {
  it('never lets one employee see, fetch, attach or delete another’s images', async () => {
    const owner = await signIn();
    const stranger = await signIn();
    const generated = await imageService.generateImages(owner.actor, { prompt: 'Private' });
    const imageId = String(generated.images[0]?._id);

    const list = await request(app).get(url).set('Authorization', stranger.authorization);
    expect(list.body.data.items).toHaveLength(0);

    // A 404 rather than a 403: a 403 would confirm the id exists.
    for (const response of [
      await request(app).get(`${url}/${imageId}`).set('Authorization', stranger.authorization),
      // The bytes are behind the same check, which is why they are not served
      // from a static directory.
      await request(app).get(`${url}/${imageId}/file`).set('Authorization', stranger.authorization),
      await request(app)
        .post(`${url}/${imageId}/attach`)
        .set('Authorization', stranger.authorization)
        .send({ contentItemId: null }),
      await request(app).delete(`${url}/${imageId}`).set('Authorization', stranger.authorization),
    ]) {
      expect(response.status).toBe(HTTP_STATUS.NOT_FOUND);
    }

    // Untouched.
    expect(await ImageAssetModel.findById(imageId).lean().exec()).toMatchObject({
      prompt: 'Private',
      status: 'completed',
    });
    await expect(imageService.getImage(stranger.actor, imageId)).rejects.toThrow(/not found/i);
  });

  it('refuses an unauthenticated request, including for the bytes', async () => {
    const { actor } = await signIn();
    const generated = await imageService.generateImages(actor, { prompt: 'Private' });

    expect((await request(app).get(url)).status).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect(
      (await request(app).get(`${url}/${String(generated.images[0]?._id)}/file`)).status,
    ).toBe(HTTP_STATUS.UNAUTHORIZED);
  });
});

describe('provider status', () => {
  it('reports what is available without exposing a credential', async () => {
    const { authorization } = await signIn();

    const response = await request(app).get(`${url}/status`).set('Authorization', authorization);

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data).toMatchObject({ storage: 'local' });
    expect(JSON.stringify(response.body)).not.toMatch(/sk-|apiKey|api_key/i);
  });
});
