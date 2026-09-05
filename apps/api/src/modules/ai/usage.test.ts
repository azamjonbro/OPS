import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { HTTP_STATUS } from '../../core/http/http-status.js';
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../../test/database.js';
import { createTestBranch, signInAs } from '../../test/factories.js';
import * as conversationService from '../conversations/conversation.service.js';

const app = createApp();

beforeAll(startTestDatabase);
afterAll(stopTestDatabase);
beforeEach(clearTestDatabase);

/**
 * What the assistant has cost, read from what was actually stored.
 *
 * This exists because the provider will not tell us: an ordinary project key
 * cannot read a balance, by OpenAI's own design. So the honest thing to report
 * is what went through this application, and these hold that it is counted from
 * real turns rather than estimated.
 */
const signIn = async (role: 'cashier' | 'manager' = 'manager') => {
  const branch = await createTestBranch();

  return signInAs(app, role, String(branch._id));
};

const seedTurn = async (
  actor: Awaited<ReturnType<typeof signIn>>['actor'],
  promptTokens: number,
  completionTokens: number,
) => {
  const conversation = await conversationService.createConversation(actor, { title: 'Savdo' });

  await conversationService.appendMessage(actor, {
    conversationId: String(conversation._id),
    role: 'user',
    content: 'Bugungi savdo?',
  });
  await conversationService.appendMessage(actor, {
    conversationId: String(conversation._id),
    role: 'assistant',
    content: '12 ta savdo.',
    model: 'gpt-5',
    usage: { promptTokens, completionTokens },
  });
};

describe('GET /api/v1/ai/usage', () => {
  it('is refused without a token', async () => {
    const response = await request(app).get('/api/v1/ai/usage');

    expect(response.status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });

  it('totals the tokens of real assistant turns, and no others', async () => {
    const { actor, authorization } = await signIn();
    await seedTurn(actor, 1_000, 200);
    await seedTurn(actor, 500, 100);

    const response = await request(app).get('/api/v1/ai/usage').set('Authorization', authorization);

    expect(response.status).toBe(HTTP_STATUS.OK);
    // Two assistant turns. The user's own messages carry no usage and must not
    // be counted as if they had cost something.
    expect(response.body.data.totals).toMatchObject({
      turns: 2,
      promptTokens: 1_500,
      completionTokens: 300,
    });
    expect(response.body.data.conversationCount).toBe(2);
    expect(response.body.data.byModel).toEqual([
      { model: 'gpt-5', turns: 2, promptTokens: 1_500, completionTokens: 300 },
    ]);
  });

  it('answers with zeroes rather than nothing before the first turn', async () => {
    const { authorization } = await signIn();

    const response = await request(app).get('/api/v1/ai/usage').set('Authorization', authorization);

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data.totals).toMatchObject({ turns: 0, promptTokens: 0 });
    expect(response.body.data.totals.firstAt).toBeNull();
  });

  it('counts only the signed-in employee’s own turns', async () => {
    const mine = await signIn();
    const theirs = await signIn();
    await seedTurn(mine.actor, 1_000, 200);
    await seedTurn(theirs.actor, 9_999, 999);

    const response = await request(app)
      .get('/api/v1/ai/usage')
      .set('Authorization', mine.authorization);

    expect(response.body.data.totals.promptTokens).toBe(1_000);
  });

  it('gives a manager the organisation total, as counts and nothing else', async () => {
    const mine = await signIn('manager');
    const theirs = await signIn('manager');
    await seedTurn(mine.actor, 1_000, 200);
    await seedTurn(theirs.actor, 4_000, 800);

    const response = await request(app)
      .get('/api/v1/ai/usage')
      .set('Authorization', mine.authorization);

    expect(response.body.data.organisation.totals).toMatchObject({
      turns: 2,
      promptTokens: 5_000,
    });
    // A spend figure says how much was used, never what anybody asked. Nothing
    // in the payload should carry a title, a message or another user's id.
    expect(JSON.stringify(response.body.data)).not.toContain('Savdo');
  });

  it('does not give a cashier the organisation total', async () => {
    const mine = await signIn('cashier');
    const theirs = await signIn('manager');
    await seedTurn(theirs.actor, 4_000, 800);

    const response = await request(app)
      .get('/api/v1/ai/usage')
      .set('Authorization', mine.authorization);

    expect(response.body.data.organisation).toBeNull();
    expect(response.body.data.totals.turns).toBe(0);
  });
});
