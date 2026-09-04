import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { HTTP_STATUS } from '../../core/http/http-status.js';
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../../test/database.js';
import { createTestBranch, signInAs } from '../../test/factories.js';
import { ContentItemModel } from './content-item.model.js';
import { ContentPlanModel } from './content-plan.model.js';
import * as contentService from './content.service.js';

/**
 * Plans and items through the real API.
 *
 * Nothing here calls a model: these are the parts of the engine that must work
 * whether or not a model is configured — storage, editing, paging and, above
 * all, that one employee's plans are invisible to another.
 */

const app = createApp();
const plansUrl = '/api/v1/content/plans';
const itemsUrl = '/api/v1/content/items';

beforeAll(startTestDatabase);
afterAll(stopTestDatabase);
beforeEach(clearTestDatabase);

const signIn = async () => {
  const branch = await createTestBranch();

  return signInAs(app, 'manager', String(branch._id));
};

const samplePlan = (overrides: Record<string, unknown> = {}) => ({
  title: '7 kunlik Instagram plan',
  description: 'Hadiya uchun',
  platform: 'instagram',
  startDate: '2026-09-07',
  items: [
    {
      date: '2026-09-07',
      contentType: 'post',
      title: 'Yangi kolleksiya',
      idea: "Do'kondagi yangi mahsulotlar",
      caption: 'Yangi kolleksiya keldi!',
      callToAction: "Do'konga keling",
      hashtags: ['#Yangi', 'hadiya'],
    },
    {
      date: '2026-09-08',
      contentType: 'reel',
      title: 'Kunlik hayot',
      idea: "Do'kon ortidagi jarayon",
    },
  ],
  ...overrides,
});

const createPlan = async (authorization: string, overrides: Record<string, unknown> = {}) => {
  const response = await request(app)
    .post(plansUrl)
    .set('Authorization', authorization)
    .send(samplePlan(overrides));

  if (response.status !== HTTP_STATUS.CREATED) {
    throw new Error(`Plan setup failed: ${response.status} ${JSON.stringify(response.body)}`);
  }

  return response.body.data as { id: string; itemCount: number };
};

describe(`POST ${plansUrl}`, () => {
  it('stores a plan and its days together', async () => {
    const { authorization } = await signIn();

    const response = await request(app)
      .post(plansUrl)
      .set('Authorization', authorization)
      .send(samplePlan());

    expect(response.status).toBe(HTTP_STATUS.CREATED);
    expect(response.body.data).toMatchObject({
      title: '7 kunlik Instagram plan',
      platform: 'instagram',
      status: 'draft',
      itemCount: 2,
    });
    // The end date follows the days, so a plan never hides its own content.
    expect(response.body.data.endDate).toBe('2026-09-08T00:00:00.000Z');
    expect(await ContentItemModel.countDocuments().exec()).toBe(2);
  });

  it('derives each item’s status from whether it has copy yet', async () => {
    const { authorization } = await signIn();
    const plan = await createPlan(authorization);

    const detail = await request(app)
      .get(`${plansUrl}/${plan.id}`)
      .set('Authorization', authorization);

    const [first, second] = detail.body.data.items;
    expect(first).toMatchObject({ status: 'draft', hashtags: ['Yangi', 'hadiya'] });
    // A topic with no caption is still only an idea.
    expect(second).toMatchObject({ status: 'idea', caption: null });
  });

  it('stores an item on the plan’s platform unless it says otherwise', async () => {
    const { authorization } = await signIn();
    const plan = await createPlan(authorization, {
      platform: 'telegram',
      items: [
        { date: '2026-09-07', contentType: 'post', title: 'a', idea: 'b' },
        {
          date: '2026-09-08',
          contentType: 'reel',
          title: 'c',
          idea: 'd',
          platform: 'tiktok',
        },
      ],
    });

    const detail = await request(app)
      .get(`${plansUrl}/${plan.id}`)
      .set('Authorization', authorization);

    expect(detail.body.data.items.map((item: { platform: string }) => item.platform)).toEqual([
      'telegram',
      'tiktok',
    ]);
  });

  it('refuses an unknown platform or content type', async () => {
    const { authorization } = await signIn();

    const badPlatform = await request(app)
      .post(plansUrl)
      .set('Authorization', authorization)
      .send(samplePlan({ platform: 'myspace' }));
    const badType = await request(app)
      .post(plansUrl)
      .set('Authorization', authorization)
      .send(
        samplePlan({
          items: [{ date: '2026-09-07', contentType: 'hologram', title: 'a', idea: 'b' }],
        }),
      );

    expect(badPlatform.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    expect(badType.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    expect(await ContentPlanModel.countDocuments().exec()).toBe(0);
  });

  it('creates a plan with no days, for one filled in later', async () => {
    const { authorization } = await signIn();

    const response = await request(app)
      .post(plansUrl)
      .set('Authorization', authorization)
      .send(samplePlan({ items: undefined }));

    expect(response.status).toBe(HTTP_STATUS.CREATED);
    expect(response.body.data.itemCount).toBe(0);
  });
});

describe(`GET ${plansUrl}`, () => {
  it('pages the list and reports the totals', async () => {
    const { authorization } = await signIn();

    for (let index = 0; index < 5; index += 1) {
      await createPlan(authorization, {
        title: `Plan ${index}`,
        startDate: `2026-09-0${index + 1}`,
        items: undefined,
      });
    }

    const firstPage = await request(app)
      .get(plansUrl)
      .query({ page: 1, pageSize: 2 })
      .set('Authorization', authorization);
    const lastPage = await request(app)
      .get(plansUrl)
      .query({ page: 3, pageSize: 2 })
      .set('Authorization', authorization);

    expect(firstPage.body.data.items).toHaveLength(2);
    expect(firstPage.body.data.pagination).toMatchObject({
      page: 1,
      pageSize: 2,
      total: 5,
      totalPages: 3,
      hasPrevious: false,
      hasNext: true,
    });
    expect(lastPage.body.data.items).toHaveLength(1);
    expect(lastPage.body.data.pagination).toMatchObject({ hasNext: false, hasPrevious: true });
    // Newest first, so the most recent campaign is the one on screen.
    expect(firstPage.body.data.items[0].title).toBe('Plan 4');
  });

  it('filters by status, platform and title', async () => {
    const { authorization } = await signIn();

    await createPlan(authorization, { title: 'Instagram autumn', items: undefined });
    await createPlan(authorization, {
      title: 'Telegram launch',
      platform: 'telegram',
      status: 'active',
      items: undefined,
    });

    const byPlatform = await request(app)
      .get(plansUrl)
      .query({ platform: 'telegram' })
      .set('Authorization', authorization);
    const byStatus = await request(app)
      .get(plansUrl)
      .query({ status: 'active' })
      .set('Authorization', authorization);
    const bySearch = await request(app)
      .get(plansUrl)
      .query({ search: 'autumn' })
      .set('Authorization', authorization);

    expect(byPlatform.body.data.items).toHaveLength(1);
    expect(byStatus.body.data.items[0].title).toBe('Telegram launch');
    expect(bySearch.body.data.items[0].title).toBe('Instagram autumn');
  });

  it('returns a plan with its days in date order', async () => {
    const { authorization } = await signIn();
    const plan = await createPlan(authorization, {
      items: [
        { date: '2026-09-09', contentType: 'post', title: 'Later', idea: 'x' },
        { date: '2026-09-07', contentType: 'post', title: 'Earlier', idea: 'y' },
      ],
    });

    const response = await request(app)
      .get(`${plansUrl}/${plan.id}`)
      .set('Authorization', authorization);

    expect(response.body.data.items.map((item: { title: string }) => item.title)).toEqual([
      'Earlier',
      'Later',
    ]);
  });
});

describe(`PATCH ${plansUrl}/:id`, () => {
  it('changes a plan without touching its days', async () => {
    const { authorization } = await signIn();
    const plan = await createPlan(authorization);

    const response = await request(app)
      .patch(`${plansUrl}/${plan.id}`)
      .set('Authorization', authorization)
      .send({ title: 'Renamed', status: 'active' });

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data).toMatchObject({ title: 'Renamed', status: 'active', itemCount: 2 });
    expect(await ContentItemModel.countDocuments().exec()).toBe(2);
  });
});

describe('items', () => {
  it('adds a day and keeps the counter and the end date honest', async () => {
    const { authorization } = await signIn();
    const plan = await createPlan(authorization);

    const response = await request(app)
      .post(`${plansUrl}/${plan.id}/items`)
      .set('Authorization', authorization)
      .send({
        date: '2026-09-12',
        contentType: 'story',
        title: 'Juma taklifi',
        idea: 'Haftalik chegirma',
      });

    expect(response.status).toBe(HTTP_STATUS.CREATED);

    const detail = await request(app)
      .get(`${plansUrl}/${plan.id}`)
      .set('Authorization', authorization);

    expect(detail.body.data.itemCount).toBe(3);
    // A day past the stated range widens the plan rather than vanishing from
    // every date-bounded read of it.
    expect(detail.body.data.endDate).toBe('2026-09-12T00:00:00.000Z');
  });

  it('changes only the fields it is given', async () => {
    const { authorization } = await signIn();
    const plan = await createPlan(authorization);
    const detail = await request(app)
      .get(`${plansUrl}/${plan.id}`)
      .set('Authorization', authorization);
    const item = detail.body.data.items[0];

    const response = await request(app)
      .patch(`${itemsUrl}/${item.id}`)
      .set('Authorization', authorization)
      .send({ caption: 'Qisqaroq caption.' });

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data).toMatchObject({
      caption: 'Qisqaroq caption.',
      // Everything not named survives: this is what makes a targeted edit safe.
      title: item.title,
      idea: item.idea,
      hashtags: item.hashtags,
      contentType: item.contentType,
    });
  });

  it('lists items across plans, filtered and paged', async () => {
    const { authorization } = await signIn();
    await createPlan(authorization);
    await createPlan(authorization, {
      title: 'Second',
      platform: 'telegram',
      items: [{ date: '2026-09-10', contentType: 'announcement', title: 'Xabar', idea: 'z' }],
    });

    const all = await request(app).get(itemsUrl).set('Authorization', authorization);
    const byPlatform = await request(app)
      .get(itemsUrl)
      .query({ platform: 'telegram' })
      .set('Authorization', authorization);
    const byDate = await request(app)
      .get(itemsUrl)
      .query({ from: '2026-09-08', to: '2026-09-10' })
      .set('Authorization', authorization);
    const paged = await request(app)
      .get(itemsUrl)
      .query({ pageSize: 2 })
      .set('Authorization', authorization);

    expect(all.body.data.pagination.total).toBe(3);
    expect(byPlatform.body.data.items).toHaveLength(1);
    expect(byDate.body.data.items).toHaveLength(2);
    expect(paged.body.data.items).toHaveLength(2);
    expect(paged.body.data.pagination).toMatchObject({ total: 3, totalPages: 2, hasNext: true });
  });

  it('deletes a day and corrects the plan’s counter', async () => {
    const { authorization } = await signIn();
    const plan = await createPlan(authorization);
    const detail = await request(app)
      .get(`${plansUrl}/${plan.id}`)
      .set('Authorization', authorization);

    const response = await request(app)
      .delete(`${itemsUrl}/${detail.body.data.items[0].id}`)
      .set('Authorization', authorization);

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data).toMatchObject({ deleted: 1 });

    const after = await request(app)
      .get(`${plansUrl}/${plan.id}`)
      .set('Authorization', authorization);
    expect(after.body.data.itemCount).toBe(1);
    expect(after.body.data.items).toHaveLength(1);
  });
});

describe(`DELETE ${plansUrl}/:id`, () => {
  it('takes the days with the plan, leaving nothing orphaned', async () => {
    const { authorization } = await signIn();
    const plan = await createPlan(authorization);

    const response = await request(app)
      .delete(`${plansUrl}/${plan.id}`)
      .set('Authorization', authorization);

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data).toMatchObject({ deletedPlan: 1, deletedItems: 2 });
    expect(await ContentPlanModel.countDocuments().exec()).toBe(0);
    expect(await ContentItemModel.countDocuments().exec()).toBe(0);
  });

  it('reports a second deletion as missing', async () => {
    const { authorization } = await signIn();
    const plan = await createPlan(authorization);

    await request(app).delete(`${plansUrl}/${plan.id}`).set('Authorization', authorization);
    const second = await request(app)
      .delete(`${plansUrl}/${plan.id}`)
      .set('Authorization', authorization);

    expect(second.status).toBe(HTTP_STATUS.NOT_FOUND);
  });
});

describe('user isolation', () => {
  it('never lets one employee see, change or delete another’s plans', async () => {
    const owner = await signIn();
    const stranger = await signIn();
    const plan = await createPlan(owner.authorization);
    const detail = await request(app)
      .get(`${plansUrl}/${plan.id}`)
      .set('Authorization', owner.authorization);
    const itemId = detail.body.data.items[0].id;

    const list = await request(app).get(plansUrl).set('Authorization', stranger.authorization);
    const items = await request(app).get(itemsUrl).set('Authorization', stranger.authorization);

    expect(list.body.data.items).toHaveLength(0);
    expect(items.body.data.items).toHaveLength(0);

    // A 404 rather than a 403: a 403 would confirm the id exists.
    for (const response of [
      await request(app).get(`${plansUrl}/${plan.id}`).set('Authorization', stranger.authorization),
      await request(app)
        .patch(`${plansUrl}/${plan.id}`)
        .set('Authorization', stranger.authorization)
        .send({ title: 'Hijacked' }),
      await request(app)
        .delete(`${plansUrl}/${plan.id}`)
        .set('Authorization', stranger.authorization),
      await request(app)
        .post(`${plansUrl}/${plan.id}/items`)
        .set('Authorization', stranger.authorization)
        .send({ date: '2026-09-09', contentType: 'post', title: 'x', idea: 'y' }),
      await request(app).get(`${itemsUrl}/${itemId}`).set('Authorization', stranger.authorization),
      await request(app)
        .patch(`${itemsUrl}/${itemId}`)
        .set('Authorization', stranger.authorization)
        .send({ caption: 'Hijacked' }),
      await request(app)
        .delete(`${itemsUrl}/${itemId}`)
        .set('Authorization', stranger.authorization),
    ]) {
      expect(response.status).toBe(HTTP_STATUS.NOT_FOUND);
    }

    // And nothing was touched.
    const after = await request(app)
      .get(`${plansUrl}/${plan.id}`)
      .set('Authorization', owner.authorization);
    expect(after.body.data).toMatchObject({ title: '7 kunlik Instagram plan', itemCount: 2 });
    expect(after.body.data.items[0].caption).toBe('Yangi kolleksiya keldi!');
  });

  it('scopes the service the same way the API is scoped', async () => {
    const owner = await signIn();
    const stranger = await signIn();
    const plan = await createPlan(owner.authorization);

    await expect(contentService.getPlan(stranger.actor, plan.id)).rejects.toThrow(/not found/i);
    await expect(contentService.deletePlan(stranger.actor, plan.id)).rejects.toThrow(/not found/i);
    expect(await contentService.listPlanItems(stranger.actor, plan.id)).toHaveLength(0);
  });

  it('refuses an unauthenticated request', async () => {
    expect((await request(app).get(plansUrl)).status).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect((await request(app).get(itemsUrl)).status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });
});
