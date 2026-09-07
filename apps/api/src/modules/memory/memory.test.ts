import type { HydratedDocument } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { HTTP_STATUS } from '../../core/http/http-status.js';
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../../test/database.js';
import { actorFor, createTestBranch, signInAs } from '../../test/factories.js';
import type { UserDocument } from '../users/user.model.js';
import { MemoryModel } from './memory.model.js';
import * as memoryService from './memory.service.js';

const app = createApp();
const url = '/api/v1/memory';

beforeAll(startTestDatabase);
afterAll(stopTestDatabase);
beforeEach(clearTestDatabase);

const signIn = async () => {
  const branch = await createTestBranch();

  return signInAs(app, 'cashier', String(branch._id));
};

const actorOf = (user: HydratedDocument<UserDocument>) => actorFor(user, { branchId: null });

describe(`POST ${url}`, () => {
  it('remembers a preference the user states themselves', async () => {
    const { authorization } = await signIn();

    const response = await request(app)
      .post(url)
      .set('Authorization', authorization)
      .send({ type: 'preference', key: 'content_language', value: 'uzbek' });

    expect(response.status).toBe(HTTP_STATUS.CREATED);
    expect(response.body.data).toMatchObject({
      type: 'preference',
      key: 'content_language',
      value: 'uzbek',
      status: 'active',
      source: 'user',
      confidence: 1,
    });
  });

  it('normalises a key so the same idea lands on one memory', async () => {
    const { authorization } = await signIn();

    await request(app)
      .post(url)
      .set('Authorization', authorization)
      .send({ type: 'preference', key: 'Response Style', value: 'concise' });
    await request(app)
      .post(url)
      .set('Authorization', authorization)
      .send({ type: 'preference', key: 'response-style', value: 'detailed' });

    const list = await request(app).get(url).set('Authorization', authorization);

    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.items[0]).toMatchObject({ key: 'response_style', value: 'detailed' });
  });

  it('refuses to store a credential', async () => {
    const { authorization } = await signIn();

    const response = await request(app)
      .post(url)
      .set('Authorization', authorization)
      .send({ type: 'fact', key: 'billz_api_key', value: 'sk-abcdefghijklmnopqrstuvwxyz012345' });

    expect(response.status).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(response.body.error.message).toMatch(/never saved to memory/i);
    expect(await MemoryModel.countDocuments().exec()).toBe(0);
  });
});

describe('confidence and confirmation', () => {
  it('holds a low-confidence assistant memory as pending and keeps it out of context', async () => {
    const { user } = await signIn();
    const actor = actorOf(user);

    const result = await memoryService.remember(actor, {
      type: 'fact',
      key: 'supplier_preference',
      value: 'maybe Anhor Logistics',
      source: 'assistant',
      confidence: 0.4,
    });

    expect(result.outcome).toBe('pending_confirmation');
    expect(result.memory?.status).toBe('pending');
    // Pending memories are never handed to the model.
    expect(await memoryService.listActiveMemories(actor, 10)).toHaveLength(0);
  });

  it('trusts what the user states outright, whatever confidence is passed', async () => {
    const { user } = await signIn();

    const result = await memoryService.remember(actorOf(user), {
      type: 'preference',
      key: 'report_language',
      value: 'uzbek',
      source: 'user',
      confidence: 0.1,
    });

    expect(result.outcome).toBe('saved');
    expect(result.memory?.status).toBe('active');
  });

  it('activates a pending memory once it is confirmed', async () => {
    const { user, authorization } = await signIn();
    const pending = await memoryService.remember(actorOf(user), {
      type: 'fact',
      key: 'shop_opens_at',
      value: '09:00',
      source: 'assistant',
      confidence: 0.3,
    });

    const response = await request(app)
      .post(`${url}/${String(pending.memory?._id)}/confirm`)
      .set('Authorization', authorization);

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data).toMatchObject({ status: 'active', source: 'user', confidence: 1 });
  });
});

describe('forgetting', () => {
  it('stops using a forgotten memory but keeps the record it existed', async () => {
    const { user, authorization } = await signIn();
    const actor = actorOf(user);
    const saved = await memoryService.remember(actor, {
      type: 'preference',
      key: 'content_language',
      value: 'uzbek',
      source: 'user',
    });

    const response = await request(app)
      .delete(`${url}/${String(saved.memory?._id)}`)
      .set('Authorization', authorization);

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data).toEqual({ forgotten: 1 });
    expect(await memoryService.listActiveMemories(actor, 10)).toHaveLength(0);

    const tombstone = await MemoryModel.findById(String(saved.memory?._id)).lean().exec();
    expect(tombstone).toMatchObject({ status: 'deleted' });
    expect(tombstone?.deletedAt).toBeInstanceOf(Date);
  });

  it('forgets by key, which is how the assistant refers to a memory', async () => {
    const { user, authorization } = await signIn();
    await memoryService.remember(actorOf(user), {
      type: 'preference',
      key: 'response_style',
      value: 'concise',
      source: 'user',
    });

    const response = await request(app)
      .delete(`${url}/by-key`)
      .query({ type: 'preference', key: 'response_style' })
      .set('Authorization', authorization);

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data).toEqual({ forgotten: 1 });
  });

  it('lets the same key be learned again after being forgotten', async () => {
    const { user } = await signIn();
    const actor = actorOf(user);

    await memoryService.remember(actor, {
      type: 'preference',
      key: 'content_language',
      value: 'uzbek',
      source: 'user',
    });
    await memoryService.forget(actor, { type: 'preference', key: 'content_language' });
    const relearned = await memoryService.remember(actor, {
      type: 'preference',
      key: 'content_language',
      value: 'russian',
      source: 'user',
    });

    expect(relearned.outcome).toBe('saved');
    const active = await memoryService.listActiveMemories(actor, 10);
    expect(active).toHaveLength(1);
    expect(active[0]?.value).toBe('russian');
  });
});

describe('user isolation', () => {
  it('never returns, reads or forgets another employee’s memory', async () => {
    const owner = await signIn();
    const stranger = await signIn();

    const saved = await memoryService.remember(actorOf(owner.user), {
      type: 'preference',
      key: 'content_language',
      value: 'uzbek',
      source: 'user',
    });
    const memoryId = String(saved.memory?._id);

    const list = await request(app).get(url).set('Authorization', stranger.authorization);
    const read = await request(app)
      .get(`${url}/${memoryId}`)
      .set('Authorization', stranger.authorization);
    const forget = await request(app)
      .delete(`${url}/${memoryId}`)
      .set('Authorization', stranger.authorization);

    expect(list.body.data.items).toHaveLength(0);
    expect(read.status).toBe(HTTP_STATUS.NOT_FOUND);
    // Nothing matched, and that is reported the way every other by-id route
    // reports it. Answering `200 { forgotten: 0 }` told the caller their delete
    // had succeeded on a record that is still there and is not theirs.
    expect(forget.status).toBe(HTTP_STATUS.NOT_FOUND);

    // The owner's memory is still active.
    expect(await memoryService.listActiveMemories(actorOf(owner.user), 10)).toHaveLength(1);
  });

  it('keeps the same key separate for two employees', async () => {
    const first = await signIn();
    const second = await signIn();

    await memoryService.remember(actorOf(first.user), {
      type: 'preference',
      key: 'content_language',
      value: 'uzbek',
      source: 'user',
    });
    await memoryService.remember(actorOf(second.user), {
      type: 'preference',
      key: 'content_language',
      value: 'russian',
      source: 'user',
    });

    expect((await memoryService.listActiveMemories(actorOf(first.user), 10))[0]?.value).toBe(
      'uzbek',
    );
    expect((await memoryService.listActiveMemories(actorOf(second.user), 10))[0]?.value).toBe(
      'russian',
    );
  });
});

describe('pagination', () => {
  it('pages a long memory list', async () => {
    const { user, authorization } = await signIn();

    for (let index = 1; index <= 12; index += 1) {
      await memoryService.remember(actorOf(user), {
        type: 'fact',
        key: `fact_${index}`,
        value: `value ${index}`,
        source: 'user',
      });
    }

    const response = await request(app)
      .get(url)
      .query({ page: 2, pageSize: 5 })
      .set('Authorization', authorization);

    expect(response.body.data.items).toHaveLength(5);
    expect(response.body.data.pagination).toMatchObject({
      page: 2,
      total: 12,
      totalPages: 3,
      hasPrevious: true,
      hasNext: true,
    });
  });
});
