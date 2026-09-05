import { DEFAULT_QUIET_HOURS, type AuthenticatedUser } from '@hadiya/shared';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { HTTP_STATUS } from '../../core/http/http-status.js';
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../../test/database.js';
import { createTestBranch, signInAs } from '../../test/factories.js';
import type { BillzCapabilityRunner } from '../billz/index.js';
import type { BillzSale } from '../billz/billz.types.js';
import { clearAnalyticsCache } from '../analytics/analytics.cache.js';
import { NotificationModel } from '../notifications/notification.model.js';
import { registerDefaultNotificationProviders } from '../notifications/providers/index.js';
import { AlertModel } from './alert.model.js';
import { evaluateForActor } from './alert.evaluator.js';
import {
  getPreferences,
  isWithinQuietHours,
  listAlerts,
  summariseAlerts,
  updatePreferences,
} from './alert.service.js';
import { ALERT_TOOLS } from './alert.tools.js';

/**
 * Alerts end to end, against a scripted Billz.
 *
 * The cases that matter most are the quiet ones. Any implementation can detect
 * a drop; what decides whether anybody keeps the feature switched on is that
 * detecting the same drop twelve times produces one notification, and that a
 * shelf which has been refilled stops looking like an open problem.
 */
const app = createApp();

beforeAll(async () => {
  await startTestDatabase();
  registerDefaultNotificationProviders();
});
afterAll(stopTestDatabase);
beforeEach(async () => {
  await clearTestDatabase();
  clearAnalyticsCache();
});
afterEach(clearAnalyticsCache);

const actor = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: '68c0000000000000000000a1',
  username: 'aziz',
  fullName: 'Aziz',
  role: 'manager',
  branchId: null,
  timezone: 'Asia/Tashkent',
  ...overrides,
});

const sale = (overrides: Partial<BillzSale> = {}): BillzSale => ({
  externalId: 's1',
  type: 'sale',
  parentExternalId: null,
  shopExternalId: 'shop-1',
  shopName: 'Chilonzor',
  customerExternalId: null,
  customerName: null,
  total: 100_000,
  debtAmount: null,
  items: [
    {
      productExternalId: 'p1',
      name: 'Choy',
      sku: 'CHOY-1',
      barcode: null,
      quantity: 1,
      unit: null,
      unitPrice: 100_000,
      discount: 0,
      lineTotal: 100_000,
      isReturned: false,
    },
  ],
  payments: [],
  soldAt: '2026-09-06T09:00:00Z',
  ...overrides,
});

/** A Billz that answers from a fixture. */
const scripted = (byRange: Record<string, BillzSale[]>, inventory: unknown[] = []) =>
  ({
    getSales: async (args: { from: string; to: string }) => {
      const items = byRange[`${args.from}..${args.to}`] ?? [];

      return { items, total: items.length };
    },
    getInventory: async () => inventory,
  }) as unknown as BillzCapabilityRunner;

/** 09:00 Tashkent on the 6th, so "today" is the 6th and "yesterday" the 5th. */
const NOW = new Date('2026-09-06T04:00:00Z');

/**
 * Takings down 30% overnight: past the -20% line, and `medium` rather than
 * critical, so escalation has somewhere to go.
 */
const slowDay = () =>
  scripted({
    '2026-09-06..2026-09-06': [sale({ externalId: 'a', total: 70_000_000 })],
    '2026-09-05..2026-09-05': [
      sale({ externalId: 'b', total: 100_000_000, soldAt: '2026-09-05T09:00:00Z' }),
    ],
    '2026-09-01..2026-09-06': [],
  });

/** Takings down 60%: far enough past the line to reach critical. */
const collapsingShop = () =>
  scripted({
    '2026-09-06..2026-09-06': [sale({ externalId: 'a', total: 40_000_000 })],
    '2026-09-05..2026-09-05': [
      sale({ externalId: 'b', total: 100_000_000, soldAt: '2026-09-05T09:00:00Z' }),
    ],
    // The anomaly rule reads the month; kept flat so it contributes nothing.
    '2026-09-01..2026-09-06': [],
  });

describe('detecting a change', () => {
  it('raises a revenue drop and tells the person once', async () => {
    const result = await evaluateForActor(actor(), NOW, { runner: collapsingShop() });

    expect(result.created).toBe(1);
    expect(result.notified).toBe(1);

    const alerts = await AlertModel.find({}).lean().exec();

    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.type).toBe('REVENUE_DROP');
    expect(alerts[0]?.status).toBe('notified');
    expect(alerts[0]?.evidence.changePercent).toBe(-60);

    const notifications = await NotificationModel.find({}).lean().exec();

    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.category).toBe('alert');
    expect(notifications[0]?.metadata.alertType).toBe('REVENUE_DROP');
  });

  it('stays silent on an ordinary day', async () => {
    const steady = scripted({
      '2026-09-06..2026-09-06': [sale({ externalId: 'a', total: 98_000_000 })],
      '2026-09-05..2026-09-05': [
        sale({ externalId: 'b', total: 100_000_000, soldAt: '2026-09-05T09:00:00Z' }),
      ],
      '2026-09-01..2026-09-06': [],
    });

    const result = await evaluateForActor(actor(), NOW, { runner: steady });

    expect(result.created).toBe(0);
    expect(result.notified).toBe(0);
    expect(await NotificationModel.countDocuments({})).toBe(0);
  });

  it('raises low stock from the analytics inventory read', async () => {
    const runner = scripted(
      {
        '2026-09-06..2026-09-06': [sale({ externalId: 'a', total: 100_000_000 })],
        '2026-09-05..2026-09-05': [
          sale({ externalId: 'b', total: 100_000_000, soldAt: '2026-09-05T09:00:00Z' }),
        ],
        '2026-09-01..2026-09-06': [],
      },
      [
        {
          productExternalId: 'p9',
          productName: 'Choy',
          sku: 'CHOY-1',
          shopId: 'shop-1',
          shopName: 'Chilonzor',
          quantity: 1,
          retailPrice: 10_000,
          stockValue: 10_000,
        },
      ],
    );

    await evaluateForActor(actor(), NOW, { runner });

    const stock = await AlertModel.findOne({ type: 'LOW_STOCK' }).lean().exec();

    expect(stock).not.toBeNull();
    // The SKU rides along so two variants sharing a name stay distinguishable.
    expect(stock?.entityName).toBe('Choy (CHOY-1)');
    expect(stock?.evidence.currentValue).toBe(1);
  });
});

describe('the same condition, evaluated repeatedly', () => {
  it('produces one alert and one notification, not ten', async () => {
    const runner = collapsingShop();

    for (let pass = 0; pass < 10; pass += 1) {
      // The clock advances a minute a pass, well inside the cooldown.
      await evaluateForActor(actor(), new Date(NOW.getTime() + pass * 60_000), { runner });
    }

    // The guarantee the whole phase exists to make.
    expect(await AlertModel.countDocuments({})).toBe(1);
    expect(await NotificationModel.countDocuments({})).toBe(1);

    const alert = await AlertModel.findOne({}).lean().exec();

    // Every sighting is still recorded, so "how long has this been going on?"
    // remains answerable even though only the first was announced.
    expect(alert?.occurrences).toBe(10);
  });

  it('speaks again when the condition gets materially worse', async () => {
    await evaluateForActor(actor(), NOW, { runner: slowDay() });

    clearAnalyticsCache();

    // The same day, now far worse: -30% becomes -60%, which crosses from
    // medium into critical and is therefore genuinely new information.
    const result = await evaluateForActor(actor(), new Date(NOW.getTime() + 60_000), {
      runner: collapsingShop(),
    });

    expect(result.escalated).toBe(1);
    expect(result.notified).toBe(1);

    // Still one alert: a worsening condition is the same condition, escalated.
    expect(await AlertModel.countDocuments({})).toBe(1);
    expect(await NotificationModel.countDocuments({})).toBe(2);

    const alert = await AlertModel.findOne({}).lean().exec();

    expect(alert?.severity).toBe('critical');
  });

  it('speaks again once the cooldown has expired', async () => {
    const runner = collapsingShop();

    await evaluateForActor(actor(), NOW, { runner });
    clearAnalyticsCache();

    // A day later, same condition, same severity.
    const later = new Date(NOW.getTime() + 25 * 60 * 60 * 1_000);
    const result = await evaluateForActor(actor(), later, { runner: collapsingShop() });

    // The window moved, so this is a new day's condition rather than the old
    // one re-announced — which is the honest reading of "still true tomorrow".
    expect(result.suppressed).toBe(0);
    expect(await NotificationModel.countDocuments({})).toBeGreaterThan(1);
  });
});

describe('resolution', () => {
  it('closes an alert whose condition has gone', async () => {
    await evaluateForActor(actor(), NOW, { runner: collapsingShop() });
    expect(await AlertModel.countDocuments({ status: 'notified' })).toBe(1);

    clearAnalyticsCache();

    // Trade recovers on the same day, so the drop is no longer detected.
    const recovered = scripted({
      '2026-09-06..2026-09-06': [sale({ externalId: 'a', total: 120_000_000 })],
      '2026-09-05..2026-09-05': [
        sale({ externalId: 'b', total: 100_000_000, soldAt: '2026-09-05T09:00:00Z' }),
      ],
      '2026-09-01..2026-09-06': [],
    });

    const result = await evaluateForActor(actor(), new Date(NOW.getTime() + 60_000), {
      runner: recovered,
    });

    expect(result.resolved).toBeGreaterThanOrEqual(1);

    const drop = await AlertModel.findOne({ type: 'REVENUE_DROP' }).lean().exec();

    expect(drop?.status).toBe('resolved');
    expect(drop?.resolvedAt).not.toBeNull();
  });
});

describe('preferences', () => {
  it('never notifies about a type the person switched off', async () => {
    await updatePreferences(actor(), { disabledTypes: ['REVENUE_DROP'] });

    const result = await evaluateForActor(actor(), NOW, { runner: collapsingShop() });

    expect(result.created).toBe(0);
    expect(await NotificationModel.countDocuments({})).toBe(0);
  });

  it('records but does not announce an alert below the severity floor', async () => {
    await updatePreferences(actor(), { minSeverity: 'critical' });

    // A 30% drop is `medium`, so the floor holds it back.
    const result = await evaluateForActor(actor(), NOW, { runner: slowDay() });

    // Detected and stored — so it is on the list and can be asked about — but
    // nobody was interrupted for it.
    expect(result.created).toBe(1);
    expect(result.notified).toBe(0);
    expect(await AlertModel.countDocuments({})).toBe(1);
    expect(await NotificationModel.countDocuments({})).toBe(0);
  });

  it('falls back to the shipped defaults for an account that never set any', async () => {
    const preferences = await getPreferences(actor());

    expect(preferences.disabledTypes).toEqual([]);
    expect(preferences.quietHours.enabled).toBe(false);
  });
});

describe('quiet hours', () => {
  const quiet = { ...DEFAULT_QUIET_HOURS, enabled: true, startMinute: 22 * 60, endMinute: 8 * 60 };

  it('recognises a window that crosses midnight', () => {
    // 23:00 Tashkent — inside a 22:00–08:00 window.
    expect(isWithinQuietHours(quiet, 'Asia/Tashkent', new Date('2026-09-06T18:00:00Z'))).toBe(true);
    // 03:00 Tashkent — still inside, on the other side of midnight.
    expect(isWithinQuietHours(quiet, 'Asia/Tashkent', new Date('2026-09-06T22:00:00Z'))).toBe(true);
    // 14:00 Tashkent — outside.
    expect(isWithinQuietHours(quiet, 'Asia/Tashkent', new Date('2026-09-06T09:00:00Z'))).toBe(
      false,
    );
  });

  it('reads the window in the account’s zone, not the server’s', () => {
    const instant = new Date('2026-09-06T18:00:00Z');

    expect(isWithinQuietHours(quiet, 'Asia/Tashkent', instant)).toBe(true);
    // The same instant is 18:00 in UTC, which is outside the window.
    expect(isWithinQuietHours(quiet, 'UTC', instant)).toBe(false);
  });

  it('holds a non-critical alert during the window', async () => {
    await updatePreferences(actor(), { quietHours: quiet });

    // 23:00 Tashkent.
    const result = await evaluateForActor(actor(), new Date('2026-09-06T18:00:00Z'), {
      runner: scripted({
        '2026-09-06..2026-09-06': [sale({ externalId: 'a', total: 70_000_000 })],
        '2026-09-05..2026-09-05': [
          sale({ externalId: 'b', total: 100_000_000, soldAt: '2026-09-05T09:00:00Z' }),
        ],
        '2026-09-01..2026-09-06': [],
      }),
    });

    expect(result.created).toBe(1);
    expect(result.notified).toBe(0);
    expect(await NotificationModel.countDocuments({})).toBe(0);
  });

  it('does not let critical through unless the account asked for it', async () => {
    await updatePreferences(actor(), { quietHours: { ...quiet, allowCritical: false } });

    // A -95% collapse, which reaches critical.
    await evaluateForActor(actor(), new Date('2026-09-06T18:00:00Z'), {
      runner: scripted({
        '2026-09-06..2026-09-06': [sale({ externalId: 'a', total: 5_000_000 })],
        '2026-09-05..2026-09-05': [
          sale({ externalId: 'b', total: 100_000_000, soldAt: '2026-09-05T09:00:00Z' }),
        ],
        '2026-09-01..2026-09-06': [],
      }),
    });

    // Bypass is never assumed. Waking somebody at 23:00 on a default they did
    // not choose is how a person switches every alert off.
    expect(await NotificationModel.countDocuments({})).toBe(0);
  });

  it('lets critical through when the account explicitly allowed it', async () => {
    await updatePreferences(actor(), { quietHours: { ...quiet, allowCritical: true } });

    await evaluateForActor(actor(), new Date('2026-09-06T18:00:00Z'), {
      runner: scripted({
        '2026-09-06..2026-09-06': [sale({ externalId: 'a', total: 5_000_000 })],
        '2026-09-05..2026-09-05': [
          sale({ externalId: 'b', total: 100_000_000, soldAt: '2026-09-05T09:00:00Z' }),
        ],
        '2026-09-01..2026-09-06': [],
      }),
    });

    expect(await NotificationModel.countDocuments({})).toBe(1);
  });
});

describe('failure handling', () => {
  it('invents nothing when Billz is unreachable', async () => {
    const broken = {
      getSales: async () => {
        throw new Error('billz is down');
      },
      getInventory: async () => [],
    } as unknown as BillzCapabilityRunner;

    await expect(evaluateForActor(actor(), NOW, { runner: broken })).rejects.toThrow(/billz/i);

    // The failure propagates so the scheduler retries it. What must never
    // happen is a cheerful "nothing to report" built on data that never came.
    expect(await AlertModel.countDocuments({})).toBe(0);
    expect(await NotificationModel.countDocuments({})).toBe(0);
  });
});

/** A second account, for every isolation case below. */
const other = actor({ id: '68c0000000000000000000b2', username: 'dilnoza' });

describe('isolation', () => {
  it('keeps one account’s alerts away from another', async () => {
    await evaluateForActor(actor(), NOW, { runner: collapsingShop() });
    clearAnalyticsCache();
    await evaluateForActor(other, NOW, { runner: collapsingShop() });

    const mine = await listAlerts(actor(), { page: 1, pageSize: 20, activeOnly: true });
    const theirs = await listAlerts(other, { page: 1, pageSize: 20, activeOnly: true });

    expect(mine.items).toHaveLength(1);
    expect(theirs.items).toHaveLength(1);
    // Same condition, two accounts, two independent alerts — the fingerprint
    // hashes the account in, so they cannot collide.
    expect(mine.items[0]?._id).not.toEqual(theirs.items[0]?._id);
    expect(String(mine.items[0]?.user)).toBe(actor().id);
  });

  it('does not let one account act on another’s alert', async () => {
    await evaluateForActor(actor(), NOW, { runner: collapsingShop() });
    const alert = await AlertModel.findOne({}).lean().exec();
    const tool = ALERT_TOOLS.find((entry) => entry.name === 'alerts_update_status');

    // Reported as missing rather than forbidden: a 403 would confirm the id
    // exists, which is itself a leak.
    await expect(
      tool?.execute(
        { alertId: String(alert?._id), action: 'dismiss' },
        { actor: other, conversationId: 'c1' },
      ),
    ).rejects.toThrow(/not found/i);

    // And the alert is untouched.
    expect(await AlertModel.findById(alert?._id).lean().exec()).toMatchObject({
      status: 'notified',
    });
  });

  it('counts only the asking account’s open alerts', async () => {
    await evaluateForActor(actor(), NOW, { runner: collapsingShop() });

    expect((await summariseAlerts(actor())).active).toBe(1);
    expect((await summariseAlerts(other)).active).toBe(0);
  });
});

describe('the HTTP surface', () => {
  const signIn = async () => {
    const branch = await createTestBranch();

    return signInAs(app, 'manager', String(branch._id));
  };

  it('refuses an unauthenticated request', async () => {
    const response = await request(app).get('/api/v1/alerts');

    expect(response.status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });

  it('lists an account’s own alerts and nothing else', async () => {
    const { authorization, user } = await signIn();

    await evaluateForActor({ ...actor(), id: String(user._id) }, NOW, { runner: collapsingShop() });
    clearAnalyticsCache();
    await evaluateForActor(other, NOW, { runner: collapsingShop() });

    const response = await request(app).get('/api/v1/alerts').set('Authorization', authorization);

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].type).toBe('REVENUE_DROP');
  });

  it('reports another account’s alert as missing', async () => {
    const { authorization } = await signIn();

    await evaluateForActor(other, NOW, { runner: collapsingShop() });
    const alert = await AlertModel.findOne({}).lean().exec();

    const response = await request(app)
      .get(`/api/v1/alerts/${String(alert?._id)}`)
      .set('Authorization', authorization);

    expect(response.status).toBe(HTTP_STATUS.NOT_FOUND);
  });

  it('lets the owner acknowledge one', async () => {
    const { authorization, user } = await signIn();

    await evaluateForActor({ ...actor(), id: String(user._id) }, NOW, {
      runner: collapsingShop(),
    });
    const alert = await AlertModel.findOne({}).lean().exec();

    const response = await request(app)
      .post(`/api/v1/alerts/${String(alert?._id)}/status`)
      .set('Authorization', authorization)
      .send({ action: 'acknowledge' });

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data.status).toBe('acknowledged');
  });
});

describe('the tools the agent sees', () => {
  it('classifies reads as reads and the one write as a write', () => {
    for (const tool of ALERT_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(20);

      if (tool.name === 'alerts_update_status') {
        expect(tool.mutates).toBe(true);
        expect(tool.risk).toBe('write');
      } else {
        expect(tool.mutates).toBe(false);
        expect(tool.risk).toBe('read');
      }
    }
  });

  it('exposes no way for the model to trigger an evaluation', () => {
    // A model that could start a pass could be talked into hammering Billz by
    // anybody who can type into the chat.
    const names = ALERT_TOOLS.map((tool) => tool.name).join(' ');

    expect(names).not.toMatch(/evaluate|run|schedule/i);
  });

  it('answers "bugun qanday alertlar bor?" from the stored alerts', async () => {
    await evaluateForActor(actor(), NOW, { runner: collapsingShop() });

    const tool = ALERT_TOOLS.find((entry) => entry.name === 'alerts_list');
    const outcome = await tool?.execute(
      { includeResolved: false, limit: 10 },
      { actor: actor(), conversationId: 'c1' },
    );

    expect(outcome?.summary).toMatch(/Revenue/);
    expect(outcome?.summary).toMatch(/2026-09-06/);
  });

  it('says plainly when there is nothing open', async () => {
    const tool = ALERT_TOOLS.find((entry) => entry.name === 'alerts_get_summary');
    const outcome = await tool?.execute({}, { actor: actor(), conversationId: 'c1' });

    expect(outcome?.summary).toMatch(/no open alerts/i);
  });

  it('explains an alert from its stored evidence', async () => {
    await evaluateForActor(actor(), NOW, { runner: collapsingShop() });
    const alert = await AlertModel.findOne({}).lean().exec();

    const tool = ALERT_TOOLS.find((entry) => entry.name === 'alerts_get');
    const outcome = await tool?.execute(
      { alertId: String(alert?._id) },
      { actor: actor(), conversationId: 'c1' },
    );

    // The figures travel with the alert, so "nega bu alert chiqdi?" is
    // answerable without a second Billz read and without guessing.
    expect(outcome?.summary).toMatch(/-60%/);
    expect(outcome?.summary).not.toMatch(/\bbecause\b/i);
  });
});
