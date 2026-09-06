import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { HTTP_STATUS } from '../core/http/http-status.js';
import { registerFileStorage } from '../modules/files/file-storage.js';
import * as conversationService from '../modules/conversations/conversation.service.js';
import * as notificationService from '../modules/notifications/notification.service.js';
import { inAppNotificationProvider } from '../modules/notifications/providers/in-app.provider.js';
import {
  registerNotificationProvider,
  resetNotificationProviders,
} from '../modules/notifications/providers/notification-provider.js';
import * as pendingActionService from '../modules/ai/agent/pending-action.service.js';
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../test/database.js';
import { createTestBranch, signInAs } from '../test/factories.js';

/**
 * The same question asked of every resource in Hadiya: what happens when one
 * account puts another account's id in the URL?
 *
 * The answer must always be that the record does not exist. Not `403` — a
 * forbidden says the id is real, and a caller working through ids learns
 * something from that. Not a filtered empty list either, because a list can be
 * right while a fetch by id is wrong; the two are separate code paths and this
 * exercises the second.
 *
 * The product is single-account today. This suite is not about that: it is
 * about whether ownership is enforced by the query or merely by the fact that
 * nobody has tried. Those look identical until the day a second account exists.
 */
const app = createApp();

beforeAll(async () => {
  await startTestDatabase();
  registerFileStorage();
});
afterAll(() => {
  resetNotificationProviders();

  return stopTestDatabase();
});
beforeEach(async () => {
  await clearTestDatabase();
  resetNotificationProviders();
  registerNotificationProvider(inAppNotificationProvider);
});

const twoAccounts = async () => {
  const branch = await createTestBranch();
  const owner = await signInAs(app, 'owner', String(branch._id));
  const stranger = await signInAs(app, 'owner', String(branch._id));

  return { owner, stranger };
};

const OTHER_ID = '000000000000000000000042';

describe('one account reaching for another account’s records', () => {
  it('refuses a conversation, its messages and everything hanging off it', async () => {
    const { owner, stranger } = await twoAccounts();

    const created = await request(app)
      .post('/api/v1/conversations')
      .set('authorization', owner.authorization)
      .send({ title: 'A private thread' });

    const id = created.body.data.id as string;

    await conversationService.appendMessage(owner.actor, {
      conversationId: id,
      role: 'user',
      content: 'a secret only the owner said',
    });

    const reads = [
      request(app).get(`/api/v1/conversations/${id}`),
      request(app).get(`/api/v1/conversations/${id}/messages`),
      request(app).get(`/api/v1/ai/chat/${id}/pending-actions`),
      request(app).get(`/api/v1/ai/chat/${id}/run`),
    ];

    for (const read of reads) {
      const response = await read.set('authorization', stranger.authorization);

      expect(response.status).toBe(HTTP_STATUS.NOT_FOUND);
      expect(JSON.stringify(response.body)).not.toContain('a secret only the owner said');
    }

    const writes = [
      request(app).patch(`/api/v1/conversations/${id}`).send({ title: 'renamed by a stranger' }),
      request(app).delete(`/api/v1/conversations/${id}`),
      request(app).post('/api/v1/ai/chat/cancel').send({ conversationId: id }),
    ];

    for (const write of writes) {
      expect((await write.set('authorization', stranger.authorization)).status).toBe(
        HTTP_STATUS.NOT_FOUND,
      );
    }

    // Still the owner's, untouched.
    const after = await request(app)
      .get(`/api/v1/conversations/${id}`)
      .set('authorization', owner.authorization);

    expect(after.status).toBe(HTTP_STATUS.OK);
    expect(after.body.data.title).toBe('A private thread');
  });

  it('refuses a memory', async () => {
    const { owner, stranger } = await twoAccounts();

    const created = await request(app)
      .post('/api/v1/memory')
      .set('authorization', owner.authorization)
      .send({ type: 'fact', key: 'supplier_terms', value: 'thirty days, net' });

    const id = (created.body.data.memory?.id ?? created.body.data.id) as string;

    for (const attempt of [
      request(app).get(`/api/v1/memory/${id}`),
      request(app).patch(`/api/v1/memory/${id}`).send({ value: 'rewritten' }),
      request(app).delete(`/api/v1/memory/${id}`),
    ]) {
      expect((await attempt.set('authorization', stranger.authorization)).status).toBe(
        HTTP_STATUS.NOT_FOUND,
      );
    }

    const listed = await request(app)
      .get('/api/v1/memory')
      .set('authorization', stranger.authorization);

    expect(listed.body.data.items).toHaveLength(0);
  });

  it('refuses a reminder', async () => {
    const { owner, stranger } = await twoAccounts();

    const created = await request(app)
      .post('/api/v1/reminders')
      .set('authorization', owner.authorization)
      .send({
        title: 'Pay the supplier',
        scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
      });

    const id = created.body.data.id as string;

    for (const attempt of [
      request(app).get(`/api/v1/reminders/${id}`),
      request(app).patch(`/api/v1/reminders/${id}`).send({ title: 'moved by a stranger' }),
      request(app).post(`/api/v1/reminders/${id}/cancel`),
      request(app).delete(`/api/v1/reminders/${id}`),
    ]) {
      expect((await attempt.set('authorization', stranger.authorization)).status).toBe(
        HTTP_STATUS.NOT_FOUND,
      );
    }

    const after = await request(app)
      .get(`/api/v1/reminders/${id}`)
      .set('authorization', owner.authorization);

    expect(after.body.data.title).toBe('Pay the supplier');
    expect(after.body.data.status).toBe('scheduled');
  });

  it('refuses a notification, and does not count it', async () => {
    const { owner, stranger } = await twoAccounts();

    await notificationService.deliver(['in_app'], {
      userId: owner.actor.id,
      category: 'reminder',
      title: 'Only for the owner',
      body: 'a private message',
    });

    const listed = await request(app)
      .get('/api/v1/notifications')
      .set('authorization', owner.authorization);
    const id = listed.body.data.items[0].id as string;

    for (const attempt of [
      request(app).get(`/api/v1/notifications/${id}`),
      request(app).post(`/api/v1/notifications/${id}/read`),
      request(app).delete(`/api/v1/notifications/${id}`),
    ]) {
      expect((await attempt.set('authorization', stranger.authorization)).status).toBe(
        HTTP_STATUS.NOT_FOUND,
      );
    }

    const count = await request(app)
      .get('/api/v1/notifications/unread-count')
      .set('authorization', stranger.authorization);

    expect(count.body.data.unread).toBe(0);

    // A stranger's "mark everything read" does not reach into the inbox either.
    await request(app)
      .post('/api/v1/notifications/read-all')
      .set('authorization', stranger.authorization);

    const ownerCount = await request(app)
      .get('/api/v1/notifications/unread-count')
      .set('authorization', owner.authorization);

    expect(ownerCount.body.data.unread).toBe(1);
  });

  it('refuses a document, its bytes and its deletion', async () => {
    const { owner, stranger } = await twoAccounts();

    const uploaded = await request(app)
      .post('/api/v1/files')
      .set('authorization', owner.authorization)
      .attach('file', Buffer.from('product,price\nsecret widget,999\n'), {
        filename: 'confidential.csv',
        contentType: 'text/csv',
      });

    expect(uploaded.status).toBe(HTTP_STATUS.OK);

    const id = uploaded.body.data.id as string;

    for (const attempt of [
      request(app).get(`/api/v1/files/${id}`),
      request(app).get(`/api/v1/files/${id}/download`),
      request(app).delete(`/api/v1/files/${id}`),
    ]) {
      const response = await attempt.set('authorization', stranger.authorization);

      expect(response.status).toBe(HTTP_STATUS.NOT_FOUND);
      expect(response.text).not.toContain('secret widget');
    }

    const download = await request(app)
      .get(`/api/v1/files/${id}/download`)
      .set('authorization', owner.authorization);

    expect(download.status).toBe(HTTP_STATUS.OK);
    expect(download.text).toContain('secret widget');
  });

  it('refuses a content plan and the items inside it', async () => {
    const { owner, stranger } = await twoAccounts();

    const created = await request(app)
      .post('/api/v1/content/plans')
      .set('authorization', owner.authorization)
      .send({
        title: 'September campaign',
        platform: 'instagram',
        startDate: '2026-09-01',
        items: [
          {
            date: '2026-09-02',
            contentType: 'post',
            title: 'Launch day',
            idea: 'unreleased product reveal',
          },
        ],
      });

    expect(created.status).toBe(HTTP_STATUS.CREATED);

    const planId = created.body.data.id as string;

    for (const attempt of [
      request(app).get(`/api/v1/content/plans/${planId}`),
      request(app).patch(`/api/v1/content/plans/${planId}`).send({ title: 'stolen' }),
      request(app).delete(`/api/v1/content/plans/${planId}`),
    ]) {
      const response = await attempt.set('authorization', stranger.authorization);

      expect(response.status).toBe(HTTP_STATUS.NOT_FOUND);
      expect(response.text).not.toContain('unreleased product reveal');
    }
  });

  it('refuses an integration, its audit trail and its tool permissions', async () => {
    const { owner, stranger } = await twoAccounts();

    const created = await request(app)
      .post('/api/v1/integrations')
      .set('authorization', owner.authorization)
      .send({
        provider: 'custom_mcp',
        name: 'The owner’s CRM',
        serverUrl: 'https://crm.example.com/mcp',
      });

    expect(created.status).toBe(HTTP_STATUS.CREATED);

    const id = created.body.data.id as string;

    for (const attempt of [
      request(app).get(`/api/v1/integrations/${id}`),
      request(app).patch(`/api/v1/integrations/${id}`).send({ name: 'stolen' }),
      request(app).post(`/api/v1/integrations/${id}/connect`),
      request(app).post(`/api/v1/integrations/${id}/disconnect`),
      request(app).post(`/api/v1/integrations/${id}/test`),
      request(app).delete(`/api/v1/integrations/${id}`),
      request(app)
        .patch(`/api/v1/integrations/${id}/tools/create_invoice`)
        .send({ permission: 'enabled' }),
    ]) {
      const response = await attempt.set('authorization', stranger.authorization);

      expect(response.status).toBe(HTTP_STATUS.NOT_FOUND);
    }

    // Still the owner's, still named what they named it.
    const after = await request(app)
      .get(`/api/v1/integrations/${id}`)
      .set('authorization', owner.authorization);

    expect(after.status).toBe(HTTP_STATUS.OK);
    expect(after.body.data.name).toBe('The owner’s CRM');
  });

  it('refuses an image and its bytes', async () => {
    const { owner, stranger } = await twoAccounts();

    // No provider is configured in tests, so no asset can be generated; the
    // reachable half is that an id nobody owns is answered as missing rather
    // than as forbidden or as a server error.
    void owner;

    for (const attempt of [
      request(app).get(`/api/v1/images/${OTHER_ID}`),
      request(app).get(`/api/v1/images/${OTHER_ID}/file`),
      request(app).delete(`/api/v1/images/${OTHER_ID}`),
    ]) {
      expect((await attempt.set('authorization', stranger.authorization)).status).toBe(
        HTTP_STATUS.NOT_FOUND,
      );
    }
  });

  it('refuses a run that belongs to somebody else’s account', async () => {
    const { stranger } = await twoAccounts();

    const response = await request(app)
      .get('/api/v1/ai/runs/11111111-1111-4111-8111-111111111111')
      .set('authorization', stranger.authorization);

    expect(response.status).toBe(HTTP_STATUS.NOT_FOUND);
  });

  it('will not honour a pending action prepared for another account', async () => {
    const { owner, stranger } = await twoAccounts();

    const conversation = await conversationService.createConversation(owner.actor, {
      title: 'The owner’s thread',
    });

    await pendingActionService.recordPendingAction(owner.actor, {
      conversationId: String(conversation._id),
      workflowId: 'w-1',
      requestedCallId: 'c-1',
      tool: 'delete_content_plan',
      args: { planId: 'p-1' },
      description: 'delete the September campaign',
    });

    // The stranger's own conversation has no proposal, and the owner's is not
    // theirs to consume — the lookup is scoped to both the actor and the thread.
    const strangerConversation = await conversationService.createConversation(stranger.actor, {
      title: 'A stranger’s thread',
    });

    const verdict = await pendingActionService.consumePendingAction(stranger.actor, {
      conversationId: String(strangerConversation._id),
      tool: 'delete_content_plan',
      args: { planId: 'p-1' },
    });

    expect(verdict.kind).toBe('missing');

    const acrossConversations = await pendingActionService.consumePendingAction(stranger.actor, {
      conversationId: String(conversation._id),
      tool: 'delete_content_plan',
      args: { planId: 'p-1' },
    });

    expect(acrossConversations.kind).toBe('missing');

    // And the owner's proposal is still there to be honoured, unspent.
    const mine = await pendingActionService.listPendingActions(
      owner.actor,
      String(conversation._id),
    );

    expect(mine).toHaveLength(1);
  });

  it('answers an id that belongs to nobody the same way as one that belongs to somebody', async () => {
    const { stranger } = await twoAccounts();

    // The two must be indistinguishable, or the difference is an oracle for
    // which ids exist.
    for (const path of [
      `/api/v1/conversations/${OTHER_ID}`,
      `/api/v1/memory/${OTHER_ID}`,
      `/api/v1/reminders/${OTHER_ID}`,
      `/api/v1/notifications/${OTHER_ID}`,
      `/api/v1/files/${OTHER_ID}`,
      `/api/v1/content/plans/${OTHER_ID}`,
      `/api/v1/integrations/${OTHER_ID}`,
    ]) {
      const response = await request(app).get(path).set('authorization', stranger.authorization);

      expect(response.status).toBe(HTTP_STATUS.NOT_FOUND);
    }
  });

  it('refuses a malformed id at the edge rather than in the database', async () => {
    const { stranger } = await twoAccounts();

    for (const id of ['../../etc/passwd', '%2e%2e%2f', 'null', '{"$ne":null}', 'x'.repeat(300)]) {
      const response = await request(app)
        .get(`/api/v1/memory/${encodeURIComponent(id)}`)
        .set('authorization', stranger.authorization);

      expect(response.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
      // Never a driver error, and never a server fault.
      expect(response.status).not.toBe(HTTP_STATUS.INTERNAL_SERVER_ERROR);
    }
  });
});
