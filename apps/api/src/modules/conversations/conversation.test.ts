import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { HTTP_STATUS } from '../../core/http/http-status.js';
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../../test/database.js';
import { createTestBranch, signInAs } from '../../test/factories.js';
import { MessageModel } from './message.model.js';
import { deriveTitle } from './conversation.service.js';

const app = createApp();
const url = '/api/v1/conversations';

beforeAll(startTestDatabase);
afterAll(stopTestDatabase);
beforeEach(clearTestDatabase);

const signIn = async () => {
  const branch = await createTestBranch();

  return signInAs(app, 'manager', String(branch._id));
};

describe(`POST ${url}`, () => {
  it('opens a conversation owned by the signed-in employee', async () => {
    const { user, authorization } = await signIn();

    const response = await request(app)
      .post(url)
      .set('Authorization', authorization)
      .send({ title: 'Sotuv hisoboti' });

    expect(response.status).toBe(HTTP_STATUS.CREATED);
    expect(response.body.data).toMatchObject({
      title: 'Sotuv hisoboti',
      status: 'active',
      messageCount: 0,
      lastMessageAt: null,
      user: String(user._id),
    });
  });

  it('is refused without a token', async () => {
    expect((await request(app).post(url).send({})).status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });
});

describe('titles', () => {
  it('names a thread after its opening line', () => {
    expect(deriveTitle('Bugungi savdo qancha?')).toBe('Bugungi savdo qancha?');
  });

  it('shortens a long opening line on a word boundary', () => {
    const title = deriveTitle(
      'Menga oxirgi oydagi barcha mahsulotlar bo‘yicha to‘liq savdo hisobotini tayyorlab ber',
    );

    expect(title.length).toBeLessThanOrEqual(61);
    expect(title.endsWith('…')).toBe(true);
    expect(title).not.toMatch(/\s…$/);
  });

  it('falls back when the first message is only whitespace', () => {
    expect(deriveTitle('   \n  ')).toBe('New conversation');
  });
});

describe('messages', () => {
  const seed = async (authorization: string, count: number) => {
    const conversation = await request(app)
      .post(url)
      .set('Authorization', authorization)
      .send({ title: 'History' });
    const conversationId = conversation.body.data.id as string;

    for (let index = 1; index <= count; index += 1) {
      await MessageModel.create({
        conversation: conversationId,
        user: conversation.body.data.user,
        role: index % 2 === 1 ? 'user' : 'assistant',
        content: `Message ${index}`,
        toolCalls: [],
        toolCallId: null,
        model: null,
        usage: null,
        // Distinct timestamps so ordering is deterministic.
        createdAt: new Date(Date.now() + index * 1_000),
      });
    }

    return conversationId;
  };

  it('stores and returns a transcript oldest-first within the page', async () => {
    const { authorization } = await signIn();
    const conversationId = await seed(authorization, 3);

    const response = await request(app)
      .get(`${url}/${conversationId}/messages`)
      .set('Authorization', authorization);

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data.items.map((item: { content: string }) => item.content)).toEqual([
      'Message 1',
      'Message 2',
      'Message 3',
    ]);
  });

  it('pages backwards from the newest message', async () => {
    const { authorization } = await signIn();
    const conversationId = await seed(authorization, 25);

    const first = await request(app)
      .get(`${url}/${conversationId}/messages`)
      .query({ page: 1, pageSize: 10 })
      .set('Authorization', authorization);
    const second = await request(app)
      .get(`${url}/${conversationId}/messages`)
      .query({ page: 2, pageSize: 10 })
      .set('Authorization', authorization);

    expect(first.body.data.pagination).toMatchObject({ total: 25, totalPages: 3, hasNext: true });
    // Page one holds the newest ten, page two the ten before them.
    expect(first.body.data.items[9].content).toBe('Message 25');
    expect(second.body.data.items[9].content).toBe('Message 15');
    expect(second.body.data.pagination).toMatchObject({ hasPrevious: true, hasNext: true });
  });

  it('rejects a page size beyond the cap instead of returning everything', async () => {
    const { authorization } = await signIn();
    const conversationId = await seed(authorization, 3);

    const response = await request(app)
      .get(`${url}/${conversationId}/messages`)
      .query({ pageSize: 5_000 })
      .set('Authorization', authorization);

    expect(response.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
  });
});

describe('archiving and deleting', () => {
  it('archives a thread out of the default list without losing it', async () => {
    const { authorization } = await signIn();
    const created = await request(app)
      .post(url)
      .set('Authorization', authorization)
      .send({ title: 'Old thread' });
    const conversationId = created.body.data.id as string;

    await request(app)
      .patch(`${url}/${conversationId}`)
      .set('Authorization', authorization)
      .send({ status: 'archived' });

    const active = await request(app).get(url).set('Authorization', authorization);
    const archived = await request(app)
      .get(url)
      .query({ status: 'archived' })
      .set('Authorization', authorization);

    expect(active.body.data.items).toHaveLength(0);
    expect(archived.body.data.items).toHaveLength(1);
  });

  it('deletes a thread together with its messages', async () => {
    const { authorization } = await signIn();
    const created = await request(app).post(url).set('Authorization', authorization).send({});
    const conversationId = created.body.data.id as string;

    await MessageModel.create({
      conversation: conversationId,
      user: created.body.data.user,
      role: 'user',
      content: 'Doomed',
      toolCalls: [],
      toolCallId: null,
      model: null,
      usage: null,
    });

    const response = await request(app)
      .delete(`${url}/${conversationId}`)
      .set('Authorization', authorization);

    expect(response.status).toBe(HTTP_STATUS.NO_CONTENT);
    expect(await MessageModel.countDocuments({ conversation: conversationId }).exec()).toBe(0);
  });
});

describe('user isolation', () => {
  it('hides another employee’s conversation from the list, reads and writes', async () => {
    const owner = await signIn();
    const stranger = await signIn();

    const created = await request(app)
      .post(url)
      .set('Authorization', owner.authorization)
      .send({ title: 'Private thread' });
    const conversationId = created.body.data.id as string;

    const list = await request(app).get(url).set('Authorization', stranger.authorization);
    expect(list.body.data.items).toHaveLength(0);

    // A stranger is told it does not exist, never that it exists but is theirs.
    for (const response of [
      await request(app)
        .get(`${url}/${conversationId}`)
        .set('Authorization', stranger.authorization),
      await request(app)
        .get(`${url}/${conversationId}/messages`)
        .set('Authorization', stranger.authorization),
      await request(app)
        .patch(`${url}/${conversationId}`)
        .set('Authorization', stranger.authorization)
        .send({ title: 'Stolen' }),
      await request(app)
        .delete(`${url}/${conversationId}`)
        .set('Authorization', stranger.authorization),
    ]) {
      expect(response.status).toBe(HTTP_STATUS.NOT_FOUND);
    }

    // And the owner still has it, untouched.
    const stillThere = await request(app)
      .get(`${url}/${conversationId}`)
      .set('Authorization', owner.authorization);
    expect(stillThere.body.data.title).toBe('Private thread');
  });
});
