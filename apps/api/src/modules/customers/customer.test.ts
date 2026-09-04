import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { HTTP_STATUS } from '../../core/http/http-status.js';
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../../test/database.js';
import { createTestBranch, signInAs } from '../../test/factories.js';

const app = createApp();
const url = '/api/v1/customers';

beforeAll(startTestDatabase);
afterAll(stopTestDatabase);
beforeEach(clearTestDatabase);

describe(`POST ${url}`, () => {
  it('registers a customer at the cashier own branch with no debt', async () => {
    const branch = await createTestBranch();
    const { authorization } = await signInAs(app, 'cashier', String(branch._id));

    const response = await request(app)
      .post(url)
      .set('Authorization', authorization)
      .send({ fullName: 'Dilnoza Karimova', phone: '+998901112233', notes: 'Prefers a receipt' });

    expect(response.status).toBe(HTTP_STATUS.CREATED);
    expect(response.body.data).toMatchObject({
      fullName: 'Dilnoza Karimova',
      phone: '+998901112233',
      status: 'active',
      debtBalance: 0,
      // The branch comes from the token, not from the request body.
      branch: String(branch._id),
    });
  });

  it('refuses a phone number that is already registered', async () => {
    const branch = await createTestBranch();
    const { authorization } = await signInAs(app, 'cashier', String(branch._id));
    const payload = { fullName: 'Aziz Rahimov', phone: '+998901112244' };

    await request(app).post(url).set('Authorization', authorization).send(payload);
    const response = await request(app).post(url).set('Authorization', authorization).send(payload);

    expect(response.status).toBe(HTTP_STATUS.CONFLICT);
  });

  it('rejects a malformed phone number', async () => {
    const branch = await createTestBranch();
    const { authorization } = await signInAs(app, 'cashier', String(branch._id));

    const response = await request(app)
      .post(url)
      .set('Authorization', authorization)
      .send({ fullName: 'Nobody', phone: 'not-a-phone' });

    expect(response.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
  });

  it('is refused without a token', async () => {
    const response = await request(app)
      .post(url)
      .send({ fullName: 'Anon', phone: '+998900000000' });

    expect(response.status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });
});

describe(`GET ${url}`, () => {
  it('does not show a cashier the customers of another branch', async () => {
    const own = await createTestBranch();
    const other = await createTestBranch();
    const mine = await signInAs(app, 'cashier', String(own._id));
    const theirs = await signInAs(app, 'cashier', String(other._id));

    await request(app)
      .post(url)
      .set('Authorization', theirs.authorization)
      .send({ fullName: 'Other branch customer', phone: '+998905556677' });

    const response = await request(app).get(url).set('Authorization', mine.authorization);

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data.items).toHaveLength(0);
  });
});

describe(`PATCH ${url}/:id`, () => {
  it('lets a manager block a customer but not a cashier', async () => {
    const branch = await createTestBranch();
    const cashier = await signInAs(app, 'cashier', String(branch._id));
    const manager = await signInAs(app, 'manager', String(branch._id));

    const created = await request(app)
      .post(url)
      .set('Authorization', cashier.authorization)
      .send({ fullName: 'Bekzod Tursunov', phone: '+998907778899' });
    const customerId = created.body.data.id;

    const refused = await request(app)
      .patch(`${url}/${customerId}`)
      .set('Authorization', cashier.authorization)
      .send({ status: 'blocked' });

    expect(refused.status).toBe(HTTP_STATUS.FORBIDDEN);

    const allowed = await request(app)
      .patch(`${url}/${customerId}`)
      .set('Authorization', manager.authorization)
      .send({ status: 'blocked' });

    expect(allowed.status).toBe(HTTP_STATUS.OK);
    expect(allowed.body.data.status).toBe('blocked');
  });
});
