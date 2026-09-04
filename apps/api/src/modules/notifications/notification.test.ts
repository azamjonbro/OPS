import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { HTTP_STATUS } from '../../core/http/http-status.js';
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../../test/database.js';
import { createTestBranch, signInAs } from '../../test/factories.js';
import { NotificationModel } from './notification.model.js';
import * as notificationService from './notification.service.js';
import { inAppNotificationProvider } from './providers/in-app.provider.js';
import { telegramNotificationProvider } from './providers/telegram.provider.js';
import {
  registerNotificationProvider,
  resetNotificationProviders,
  type NotificationProvider,
} from './providers/notification-provider.js';

const app = createApp();
const url = '/api/v1/notifications';

beforeAll(startTestDatabase);
afterAll(stopTestDatabase);

beforeEach(async () => {
  await clearTestDatabase();
  resetNotificationProviders();
  registerNotificationProvider(inAppNotificationProvider);
});

afterEach(resetNotificationProviders);

const signIn = async () => {
  const branch = await createTestBranch();

  return signInAs(app, 'cashier', String(branch._id));
};

const send = (userId: string, overrides: Record<string, unknown> = {}) =>
  notificationService.deliver(['in_app'], {
    userId,
    category: 'reminder',
    title: 'Check the till',
    body: 'End of shift',
    ...overrides,
  });

describe('delivery', () => {
  it('puts a message in the recipient’s inbox', async () => {
    const { user } = await signIn();

    const report = await send(String(user._id));

    expect(report.delivered).toBe(true);
    expect(report.results).toEqual([
      expect.objectContaining({ channel: 'in_app', status: 'delivered' }),
    ]);
    expect(await NotificationModel.countDocuments().exec()).toBe(1);
  });

  it('delivers a keyed message once, however many times it is retried', async () => {
    const { user } = await signIn();

    const first = await send(String(user._id), { dedupeKey: 'reminder:1:1000' });
    const second = await send(String(user._id), { dedupeKey: 'reminder:1:1000' });

    expect(first.results[0]?.status).toBe('delivered');
    // Recognised, not repeated — and still reported as delivered, because the
    // person does have the message.
    expect(second.results[0]?.status).toBe('duplicate');
    expect(second.delivered).toBe(true);
    expect(await NotificationModel.countDocuments().exec()).toBe(1);
  });

  it('keeps unkeyed messages separate', async () => {
    const { user } = await signIn();

    await send(String(user._id));
    await send(String(user._id));

    // A direct system message has no delivery identity, so two of them are two.
    expect(await NotificationModel.countDocuments().exec()).toBe(2);
  });

  it('skips a channel that has no provider, and says so', async () => {
    const { user } = await signIn();

    const report = await notificationService.deliver(['email', 'in_app'], {
      userId: String(user._id),
      category: 'system',
      title: 'Mixed',
      body: 'One channel is missing',
    });

    expect(report.delivered).toBe(true);
    expect(report.results[0]).toMatchObject({ channel: 'email', status: 'skipped' });
    expect(report.results[1]).toMatchObject({ channel: 'in_app', status: 'delivered' });
  });

  it('reports a delivery that reached nobody', async () => {
    const { user } = await signIn();

    resetNotificationProviders();
    registerNotificationProvider(telegramNotificationProvider);

    const report = await notificationService.deliver(['telegram'], {
      userId: String(user._id),
      category: 'reminder',
      title: 'Nowhere to go',
      body: 'No channel is available',
    });

    expect(report.delivered).toBe(false);
    expect(notificationService.describeFailure(report)).toMatch(/telegram/);
  });

  it('reports a provider that threw, rather than losing the message quietly', async () => {
    const { user } = await signIn();
    const broken: NotificationProvider = {
      channel: 'in_app',
      isAvailable: () => true,
      deliver: async () => {
        throw new Error('inbox is unreachable');
      },
    };

    resetNotificationProviders();
    registerNotificationProvider(broken);

    const report = await send(String(user._id));

    expect(report.delivered).toBe(false);
    expect(report.results[0]).toMatchObject({ status: 'failed', reason: 'inbox is unreachable' });
  });
});

describe(`GET ${url}`, () => {
  it('lists the inbox newest first and counts what is unread', async () => {
    const { user, authorization } = await signIn();

    await send(String(user._id), { title: 'First' });
    await send(String(user._id), { title: 'Second' });

    const list = await request(app).get(url).set('Authorization', authorization);
    const count = await request(app).get(`${url}/unread-count`).set('Authorization', authorization);

    expect(list.status).toBe(HTTP_STATUS.OK);
    expect(list.body.data.items.map((item: { title: string }) => item.title)).toEqual([
      'Second',
      'First',
    ]);
    expect(count.body.data).toEqual({ unread: 2 });
  });

  it('filters by status', async () => {
    const { user, authorization } = await signIn();

    await send(String(user._id));
    const stored = await NotificationModel.findOne().lean().exec();
    await request(app)
      .post(`${url}/${String(stored?._id)}/read`)
      .set('Authorization', authorization);

    const unread = await request(app)
      .get(url)
      .query({ status: 'unread' })
      .set('Authorization', authorization);

    expect(unread.body.data.items).toHaveLength(0);
  });
});

describe('marking read', () => {
  it('marks one, and then all', async () => {
    const { user, authorization, actor } = await signIn();

    await send(String(user._id), { title: 'One' });
    await send(String(user._id), { title: 'Two' });

    const stored = await NotificationModel.findOne({ title: 'One' }).lean().exec();
    const single = await request(app)
      .post(`${url}/${String(stored?._id)}/read`)
      .set('Authorization', authorization);

    expect(single.status).toBe(HTTP_STATUS.OK);
    expect(single.body.data).toMatchObject({ status: 'read' });
    expect(single.body.data.readAt).not.toBeNull();

    const all = await request(app).post(`${url}/read-all`).set('Authorization', authorization);

    expect(all.body.data).toEqual({ updated: 1 });
    expect(await notificationService.countUnread(actor)).toBe(0);
  });

  it('deletes one from the inbox', async () => {
    const { user, authorization } = await signIn();

    await send(String(user._id));
    const stored = await NotificationModel.findOne().lean().exec();

    const response = await request(app)
      .delete(`${url}/${String(stored?._id)}`)
      .set('Authorization', authorization);

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(await NotificationModel.countDocuments().exec()).toBe(0);
  });
});

describe('user isolation', () => {
  it('never shows or lets anyone touch another employee’s notifications', async () => {
    const owner = await signIn();
    const stranger = await signIn();

    await send(String(owner.user._id), { title: 'Private' });
    const stored = await NotificationModel.findOne().lean().exec();
    const id = String(stored?._id);

    const list = await request(app).get(url).set('Authorization', stranger.authorization);
    const count = await request(app)
      .get(`${url}/unread-count`)
      .set('Authorization', stranger.authorization);

    expect(list.body.data.items).toHaveLength(0);
    expect(count.body.data).toEqual({ unread: 0 });

    for (const response of [
      await request(app).get(`${url}/${id}`).set('Authorization', stranger.authorization),
      await request(app).post(`${url}/${id}/read`).set('Authorization', stranger.authorization),
      await request(app).delete(`${url}/${id}`).set('Authorization', stranger.authorization),
    ]) {
      expect(response.status).toBe(HTTP_STATUS.NOT_FOUND);
    }

    // Marking everything read is scoped too, so it cannot reach across accounts.
    await request(app).post(`${url}/read-all`).set('Authorization', stranger.authorization);

    expect(await NotificationModel.findById(id).lean().exec()).toMatchObject({ status: 'unread' });
  });

  it('refuses an unauthenticated request', async () => {
    expect((await request(app).get(url)).status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });
});
