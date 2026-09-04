import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { HTTP_STATUS } from '../../core/http/http-status.js';
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../../test/database.js';
import { createTestBranch, signInAs } from '../../test/factories.js';

const app = createApp();
const url = '/api/v1/expenses';

beforeAll(startTestDatabase);
afterAll(stopTestDatabase);
beforeEach(clearTestDatabase);

describe(`POST ${url}`, () => {
  it('records a cost against the submitter own branch, pending review', async () => {
    const branch = await createTestBranch();
    const { user, authorization } = await signInAs(app, 'employee', String(branch._id));

    const response = await request(app)
      .post(url)
      .set('Authorization', authorization)
      // 450 000 UZS of shop supplies, in tiyin.
      .send({ category: 'supplies', amount: 45_000_000, description: 'Till rolls and bags' });

    expect(response.status).toBe(HTTP_STATUS.CREATED);
    expect(response.body.data).toMatchObject({
      category: 'supplies',
      amount: 45_000_000,
      status: 'pending',
      branch: String(branch._id),
      createdBy: String(user._id),
      reviewedBy: null,
    });
  });

  it('rejects an unknown category and a zero amount', async () => {
    const branch = await createTestBranch();
    const { authorization } = await signInAs(app, 'employee', String(branch._id));

    const badCategory = await request(app)
      .post(url)
      .set('Authorization', authorization)
      .send({ category: 'bribes', amount: 1000 });
    const zeroAmount = await request(app)
      .post(url)
      .set('Authorization', authorization)
      .send({ category: 'other', amount: 0 });

    expect(badCategory.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    expect(zeroAmount.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
  });

  it('is refused without a token', async () => {
    const response = await request(app).post(url).send({ category: 'other', amount: 1000 });

    expect(response.status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });
});

describe(`POST ${url}/:id/review`, () => {
  const submit = async (authorization: string) =>
    request(app)
      .post(url)
      .set('Authorization', authorization)
      .send({ category: 'transport', amount: 12_000_000 });

  it('stamps the reviewer from the token when a manager approves', async () => {
    const branch = await createTestBranch();
    const employee = await signInAs(app, 'employee', String(branch._id));
    const manager = await signInAs(app, 'manager', String(branch._id));
    const expense = await submit(employee.authorization);

    const response = await request(app)
      .post(`${url}/${expense.body.data.id}/review`)
      .set('Authorization', manager.authorization)
      .send({ status: 'approved' });

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data).toMatchObject({
      status: 'approved',
      reviewedBy: String(manager.user._id),
    });
  });

  it('will not let the submitter approve their own expense', async () => {
    const branch = await createTestBranch();
    const employee = await signInAs(app, 'employee', String(branch._id));
    const expense = await submit(employee.authorization);

    const response = await request(app)
      .post(`${url}/${expense.body.data.id}/review`)
      .set('Authorization', employee.authorization)
      .send({ status: 'approved' });

    expect(response.status).toBe(HTTP_STATUS.FORBIDDEN);
  });

  it('requires approval before an expense can be marked paid', async () => {
    const branch = await createTestBranch();
    const employee = await signInAs(app, 'employee', String(branch._id));
    const manager = await signInAs(app, 'manager', String(branch._id));
    const expense = await submit(employee.authorization);
    const reviewUrl = `${url}/${expense.body.data.id}/review`;

    const tooEarly = await request(app)
      .post(reviewUrl)
      .set('Authorization', manager.authorization)
      .send({ status: 'paid' });

    expect(tooEarly.status).toBe(HTTP_STATUS.CONFLICT);

    await request(app)
      .post(reviewUrl)
      .set('Authorization', manager.authorization)
      .send({ status: 'approved' });

    const paid = await request(app)
      .post(reviewUrl)
      .set('Authorization', manager.authorization)
      .send({ status: 'paid' });

    expect(paid.status).toBe(HTTP_STATUS.OK);
  });

  it('freezes an expense once it has been reviewed', async () => {
    const branch = await createTestBranch();
    const employee = await signInAs(app, 'employee', String(branch._id));
    const manager = await signInAs(app, 'manager', String(branch._id));
    const expense = await submit(employee.authorization);

    await request(app)
      .post(`${url}/${expense.body.data.id}/review`)
      .set('Authorization', manager.authorization)
      .send({ status: 'approved' });

    const edit = await request(app)
      .patch(`${url}/${expense.body.data.id}`)
      .set('Authorization', employee.authorization)
      .send({ amount: 1 });

    expect(edit.status).toBe(HTTP_STATUS.CONFLICT);
  });
});

describe(`GET ${url}`, () => {
  it('does not show an employee the expenses of another branch', async () => {
    const own = await createTestBranch();
    const other = await createTestBranch();
    const mine = await signInAs(app, 'employee', String(own._id));
    const theirs = await signInAs(app, 'employee', String(other._id));

    await request(app)
      .post(url)
      .set('Authorization', theirs.authorization)
      .send({ category: 'rent', amount: 500_000_000 });

    const response = await request(app).get(url).set('Authorization', mine.authorization);

    expect(response.body.data.items).toHaveLength(0);
  });
});
