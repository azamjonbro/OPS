import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { HTTP_STATUS } from '../../core/http/http-status.js';
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../../test/database.js';
import { createTestBranch, signInAs } from '../../test/factories.js';
import { ExpenseModel, type ExpenseDocument } from './expense.model.js';
import * as expenseService from './expense.service.js';

/**
 * The expense ledger end to end, with a real database.
 *
 * What these protect: that a removed cost never reappears in a total, that one
 * branch's staff cannot read or edit another's, and that the summary's
 * arithmetic is the plain sum a person could check with a calculator.
 */

const app = createApp();
const url = '/api/v1/expenses';

beforeAll(startTestDatabase);
afterAll(stopTestDatabase);

beforeEach(clearTestDatabase);

const signIn = async (role: 'cashier' | 'manager' | 'owner' = 'manager') => {
  const branch = await createTestBranch();

  return { branch, ...(await signInAs(app, role, String(branch._id))) };
};

/** Today in Tashkent, which is what an undated expense is stamped with. */
const today = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date());

const record = (authorization: string, body: Record<string, unknown>) =>
  request(app).post(url).set('Authorization', authorization).send(body);

describe(`POST ${url}`, () => {
  it('records a cost, dated today in the actor’s zone and paid in cash by default', async () => {
    const { authorization, branch, user } = await signIn();

    const response = await record(authorization, {
      category: 'rent',
      amount: 300_000_000,
      vendor: 'Ali aka',
    });

    expect(response.status).toBe(HTTP_STATUS.CREATED);
    expect(response.body.data).toMatchObject({
      category: 'rent',
      amount: 300_000_000,
      currency: 'UZS',
      date: today(),
      paymentMethod: 'cash',
      vendor: 'Ali aka',
      note: null,
      branch: String(branch._id),
      createdBy: String(user._id),
      deletedAt: null,
    });
  });

  it('accepts a back-dated bill and refuses a mistyped year', async () => {
    const { authorization } = await signIn();

    const lastMonth = await record(authorization, {
      category: 'utilities',
      amount: 45_000_000,
      date: '2026-08-05',
    });
    expect(lastMonth.status).toBe(HTTP_STATUS.CREATED);

    const wrongYear = await record(authorization, {
      category: 'utilities',
      amount: 45_000_000,
      date: '2016-08-05',
    });
    expect(wrongYear.status).toBe(HTTP_STATUS.BAD_REQUEST);

    const notADay = await record(authorization, {
      category: 'utilities',
      amount: 45_000_000,
      date: '2026-02-30',
    });
    expect(notADay.status).toBe(HTTP_STATUS.BAD_REQUEST);
  });

  it('refuses a zero, a negative and a fractional amount', async () => {
    const { authorization } = await signIn();

    for (const amount of [0, -1, 12.5]) {
      const response = await record(authorization, { category: 'other', amount });

      expect(response.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    }
  });

  it('lets a cashier record a cost for their own branch and nobody else’s', async () => {
    const { authorization, branch } = await signIn('cashier');
    const other = await createTestBranch({ name: 'Yunusobod' });

    const own = await record(authorization, { category: 'supplies', amount: 2_000_000 });
    expect(own.status).toBe(HTTP_STATUS.CREATED);
    expect(own.body.data.branch).toBe(String(branch._id));

    const elsewhere = await record(authorization, {
      category: 'supplies',
      amount: 2_000_000,
      branchId: String(other._id),
    });
    expect(elsewhere.status).toBe(HTTP_STATUS.FORBIDDEN);
  });

  it('lets an owner with no branch record a cost of the business as a whole', async () => {
    const { authorization } = await signInAs(app, 'owner', null);

    const response = await record(authorization, { category: 'taxes', amount: 90_000_000 });

    expect(response.status).toBe(HTTP_STATUS.CREATED);
    expect(response.body.data.branch).toBeNull();
  });
});

describe(`GET ${url}`, () => {
  it('lists newest day first and filters by range and category', async () => {
    const { authorization } = await signIn();

    await record(authorization, { category: 'rent', amount: 1_000, date: '2026-09-01' });
    await record(authorization, { category: 'goods', amount: 2_000, date: '2026-09-03' });
    await record(authorization, { category: 'goods', amount: 3_000, date: '2026-09-02' });

    const all = await request(app).get(url).set('Authorization', authorization);
    expect(all.body.data.items.map((row: ExpenseDocument) => row.date)).toEqual([
      '2026-09-03',
      '2026-09-02',
      '2026-09-01',
    ]);

    const goods = await request(app)
      .get(`${url}?category=goods&from=2026-09-02&to=2026-09-02`)
      .set('Authorization', authorization);
    expect(goods.body.data.items).toHaveLength(1);
    expect(goods.body.data.items[0].amount).toBe(3_000);
  });

  it('shows branch-bound staff their own branch only', async () => {
    const chilonzor = await signIn('cashier');
    const yunusobod = await signIn('cashier');

    await record(chilonzor.authorization, { category: 'supplies', amount: 1_000 });
    await record(yunusobod.authorization, { category: 'supplies', amount: 2_000 });

    const seen = await request(app).get(url).set('Authorization', chilonzor.authorization);
    expect(seen.body.data.items).toHaveLength(1);
    expect(seen.body.data.items[0].amount).toBe(1_000);

    const owner = await signInAs(app, 'owner', null);
    const everything = await request(app).get(url).set('Authorization', owner.authorization);
    expect(everything.body.data.items).toHaveLength(2);
  });
});

describe(`PATCH and DELETE ${url}/:id`, () => {
  it('lets the person who recorded a cost correct it', async () => {
    const { authorization } = await signIn('cashier');
    const created = await record(authorization, { category: 'other', amount: 5_000 });

    const response = await request(app)
      .patch(`${url}/${created.body.data.id}`)
      .set('Authorization', authorization)
      .send({ category: 'transport', amount: 7_000, note: 'Benzin' });

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data).toMatchObject({
      category: 'transport',
      amount: 7_000,
      note: 'Benzin',
    });
  });

  it('refuses one cashier editing another’s entry, and lets a manager do it', async () => {
    const branch = await createTestBranch();
    const first = await signInAs(app, 'cashier', String(branch._id));
    const second = await signInAs(app, 'cashier', String(branch._id));
    const manager = await signInAs(app, 'manager', String(branch._id));

    const created = await record(first.authorization, { category: 'other', amount: 5_000 });
    const id = created.body.data.id;

    const peer = await request(app)
      .patch(`${url}/${id}`)
      .set('Authorization', second.authorization)
      .send({ amount: 1 });
    expect(peer.status).toBe(HTTP_STATUS.FORBIDDEN);

    const boss = await request(app)
      .patch(`${url}/${id}`)
      .set('Authorization', manager.authorization)
      .send({ amount: 6_000 });
    expect(boss.status).toBe(HTTP_STATUS.OK);
    expect(boss.body.data.amount).toBe(6_000);
  });

  it('reports another branch’s entry as missing rather than forbidden', async () => {
    const chilonzor = await signIn('cashier');
    const yunusobod = await signIn('cashier');
    const created = await record(chilonzor.authorization, { category: 'other', amount: 5_000 });

    const response = await request(app)
      .get(`${url}/${created.body.data.id}`)
      .set('Authorization', yunusobod.authorization);

    expect(response.status).toBe(HTTP_STATUS.NOT_FOUND);
  });

  it('removes a cost from every list and total but keeps the row', async () => {
    const { authorization, user } = await signIn();
    const created = await record(authorization, { category: 'rent', amount: 9_000 });
    const id = created.body.data.id;

    const removed = await request(app).delete(`${url}/${id}`).set('Authorization', authorization);
    expect(removed.status).toBe(HTTP_STATUS.OK);
    expect(removed.body.data.deletedAt).not.toBeNull();

    const list = await request(app).get(url).set('Authorization', authorization);
    expect(list.body.data.items).toHaveLength(0);

    const detail = await request(app).get(`${url}/${id}`).set('Authorization', authorization);
    expect(detail.status).toBe(HTTP_STATUS.NOT_FOUND);

    const stored = await ExpenseModel.findById(id).lean<ExpenseDocument | null>().exec();
    expect(stored?.amount).toBe(9_000);
    expect(String(stored?.deletedBy)).toBe(String(user._id));
  });
});

describe(`GET ${url}/summary`, () => {
  it('totals a window by category and by day, largest category first', async () => {
    const { authorization, actor } = await signIn();

    await record(authorization, { category: 'rent', amount: 6_000, date: '2026-09-01' });
    await record(authorization, { category: 'goods', amount: 3_000, date: '2026-09-01' });
    await record(authorization, { category: 'goods', amount: 1_000, date: '2026-09-02' });
    // Outside the window, and must not be counted.
    await record(authorization, { category: 'goods', amount: 50_000, date: '2026-08-31' });

    const summary = await expenseService.summariseExpenses(actor, {
      from: '2026-09-01',
      to: '2026-09-02',
      label: '1–2 September',
    });

    expect(summary.total).toBe(10_000);
    expect(summary.count).toBe(3);
    expect(summary.byCategory[0]).toEqual({ category: 'rent', total: 6_000, count: 1, share: 60 });
    expect(summary.byCategory[1]).toEqual({ category: 'goods', total: 4_000, count: 2, share: 40 });
    // Every category is listed, even the empty ones: "nothing recorded" is news.
    expect(summary.byCategory.find((row) => row.category === 'salary')).toEqual({
      category: 'salary',
      total: 0,
      count: 0,
      share: 0,
    });
    expect(summary.daily).toEqual([
      { date: '2026-09-01', total: 9_000, count: 2 },
      { date: '2026-09-02', total: 1_000, count: 1 },
    ]);
  });

  it('leaves a removed cost out of the total', async () => {
    const { authorization } = await signIn();
    const kept = await record(authorization, {
      category: 'rent',
      amount: 6_000,
      date: '2026-09-01',
    });
    const gone = await record(authorization, {
      category: 'rent',
      amount: 4_000,
      date: '2026-09-01',
    });
    expect(kept.status).toBe(HTTP_STATUS.CREATED);

    await request(app).delete(`${url}/${gone.body.data.id}`).set('Authorization', authorization);

    const response = await request(app)
      .get(`${url}/summary?period=custom&from=2026-09-01&to=2026-09-01`)
      .set('Authorization', authorization);

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data.total).toBe(6_000);
    expect(response.body.data.count).toBe(1);
  });

  it('resolves a named period from the actor’s clock and says nothing when empty', async () => {
    const { authorization } = await signIn();

    const response = await request(app)
      .get(`${url}/summary?period=this_month`)
      .set('Authorization', authorization);

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data.period.to).toBe(today());
    expect(response.body.data.total).toBe(0);
    expect(response.body.data.byCategory.every((row: { share: null }) => row.share === null)).toBe(
      true,
    );
  });
});
