import type { BusinessAlert } from '@hadiya/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { alertService } from '@/services/alert.service';
import { notificationService } from '@/services/notification.service';
import BusinessAlertCard from './BusinessAlertCard.vue';
import NotificationCenter from './NotificationCenter.vue';

/**
 * Alerts, as the interface shows them.
 *
 * The through-line is that the browser renders and never decides: every figure
 * arrives computed, and the card is checked for showing what it was handed
 * rather than for working anything out.
 */
const alert = (overrides: Partial<BusinessAlert> = {}): BusinessAlert =>
  ({
    id: 'a1',
    user: 'u1',
    type: 'REVENUE_DROP',
    severity: 'high',
    status: 'notified',
    scope: 'business',
    entity: { kind: 'business', externalId: null, name: null },
    title: 'Revenue is down -31%',
    summary: 'Revenue for today is 69 000 000, against 100 000 000 yesterday (-31%).',
    evidence: {
      metric: 'netSales',
      currentValue: 6_900_000_000,
      previousValue: 10_000_000_000,
      changePercent: -31,
      periodFrom: '2026-09-06',
      periodTo: '2026-09-06',
      comparisonFrom: '2026-09-05',
      comparisonTo: '2026-09-05',
      dataComplete: true,
      notes: [],
    },
    fingerprint: 'f1',
    occurrences: 1,
    detectedAt: '2026-09-06T09:00:00Z',
    lastSeenAt: '2026-09-06T09:00:00Z',
    notifiedAt: '2026-09-06T09:00:00Z',
    acknowledgedAt: null,
    resolvedAt: null,
    dismissedAt: null,
    notificationId: 'n1',
    createdAt: '2026-09-06T09:00:00Z',
    updatedAt: '2026-09-06T09:00:00Z',
    ...overrides,
  }) as BusinessAlert;

beforeEach(() => {
  setActivePinia(createPinia());
  vi.restoreAllMocks();
});

describe('the alert card', () => {
  it('shows the figures it was given', () => {
    const text = mount(BusinessAlertCard, { props: { alert: alert() } }).text();

    expect(text).toContain('Revenue is down -31%');
    expect(text).toContain('-31%');
    expect(text).toContain('high');
  });

  it('prints the percentage the server computed rather than recomputing it', () => {
    // Handed a figure the values do not imply. The card must print what it was
    // told: a second implementation of the arithmetic is a second thing to keep
    // in agreement, and it would diverge the first time either changed.
    const wrapper = mount(BusinessAlertCard, {
      props: {
        alert: alert({
          evidence: {
            ...alert().evidence,
            currentValue: 10,
            previousValue: 100,
            changePercent: 42.5,
          },
        }),
      },
    });

    expect(wrapper.text()).toContain('42.5%');
  });

  it('omits the change rather than printing an infinity when there is no base', () => {
    const wrapper = mount(BusinessAlertCard, {
      props: {
        alert: alert({
          evidence: { ...alert().evidence, previousValue: null, changePercent: null },
        }),
      },
    });

    expect(wrapper.text()).not.toContain('Infinity');
    expect(wrapper.text()).not.toContain('NaN');
    expect(wrapper.text()).not.toContain('null');
  });

  it('does not carry direction or severity in colour alone', () => {
    const html = mount(BusinessAlertCard, { props: { alert: alert() } }).html();

    expect(html).toContain('↓');
    // The severity is a word on the card, not only a tint.
    expect(html).toContain('high');
  });

  it('says when the figures behind it were incomplete', () => {
    const wrapper = mount(BusinessAlertCard, {
      props: { alert: alert({ evidence: { ...alert().evidence, dataComplete: false } }) },
    });

    expect(wrapper.find('[role="note"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('incomplete');
  });

  it('offers no actions on an alert that is already resolved', () => {
    const wrapper = mount(BusinessAlertCard, {
      props: { alert: alert({ status: 'resolved' }) },
    });

    expect(wrapper.text()).toContain('resolved');
    expect(wrapper.findAll('button')).toHaveLength(0);
  });

  it('emits rather than acting, so the store owns the change', async () => {
    const wrapper = mount(BusinessAlertCard, { props: { alert: alert() } });
    const buttons = wrapper.findAll('button');

    await buttons[0]?.trigger('click');
    await buttons[1]?.trigger('click');

    expect(wrapper.emitted('acknowledge')?.[0]).toEqual(['a1']);
    expect(wrapper.emitted('dismiss')?.[0]).toEqual(['a1']);
  });

  it('shows how long a condition has been open when it has recurred', () => {
    const wrapper = mount(BusinessAlertCard, { props: { alert: alert({ occurrences: 7 }) } });

    expect(wrapper.text()).toContain('seen 7 times');
  });
});

describe('the notification centre', () => {
  const stubCounts = (active: number, unread: number) => {
    vi.spyOn(alertService, 'summary').mockResolvedValue({
      active,
      unacknowledged: active,
      bySeverity: { info: 0, low: 0, medium: active, high: 0, critical: 0 },
    });
    vi.spyOn(notificationService, 'unreadCount').mockResolvedValue({ unread });
  };

  const stubLists = (alerts: BusinessAlert[] = []) => {
    vi.spyOn(alertService, 'list').mockResolvedValue({
      items: alerts,
      pagination: {
        page: 1,
        pageSize: 20,
        total: alerts.length,
        totalPages: 1,
        hasPrevious: false,
        hasNext: false,
      },
    });
    vi.spyOn(notificationService, 'list').mockResolvedValue({
      items: [],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 0,
        totalPages: 1,
        hasPrevious: false,
        hasNext: false,
      },
    });
  };

  it('shows a badge combining open alerts and unread messages', async () => {
    stubCounts(2, 3);

    const wrapper = mount(NotificationCenter, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.find('button').text()).toContain('5');
  });

  it('shows no badge when there is nothing to say', async () => {
    stubCounts(0, 0);

    const wrapper = mount(NotificationCenter, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.find('button').text().trim()).toBe('');
  });

  it('does not load the lists until the panel is opened', async () => {
    stubCounts(1, 0);
    stubLists();

    const wrapper = mount(NotificationCenter, { attachTo: document.body });
    await flushPromises();

    // The badge sits on every screen, so only the counts are fetched up front.
    expect(alertService.list).not.toHaveBeenCalled();

    await wrapper.find('button').trigger('click');
    await flushPromises();

    expect(alertService.list).toHaveBeenCalled();
  });

  it('lists open alerts when opened', async () => {
    stubCounts(1, 0);
    stubLists([alert()]);

    const wrapper = mount(NotificationCenter, { attachTo: document.body });
    await flushPromises();
    await wrapper.find('button').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Revenue is down -31%');
  });

  it('says so plainly when nothing is wrong', async () => {
    stubCounts(0, 0);
    stubLists([]);

    const wrapper = mount(NotificationCenter, { attachTo: document.body });
    await flushPromises();
    await wrapper.find('button').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Hammasi joyida');
  });

  it('acknowledges through the service and refreshes the badge', async () => {
    stubCounts(1, 0);
    stubLists([alert()]);
    const acknowledge = vi
      .spyOn(alertService, 'acknowledge')
      .mockResolvedValue(alert({ status: 'acknowledged' }));

    const wrapper = mount(NotificationCenter, { attachTo: document.body });
    await flushPromises();
    await wrapper.find('button').trigger('click');
    await flushPromises();

    const action = wrapper.findAll('button').find((button) => button.text() === 'Ko‘rdim');
    await action?.trigger('click');
    await flushPromises();

    expect(acknowledge).toHaveBeenCalledWith('a1');
  });

  it('never asks Billz anything itself', () => {
    // The browser must not poll the POS. Detection is the scheduler's, and a
    // page that could trigger it could hammer Billz from a reload.
    const source = Object.keys(alertService).join(' ');

    expect(source).not.toMatch(/billz|evaluate|poll/i);
  });

  it('labels the bell for a screen reader, with the counts in it', async () => {
    stubCounts(2, 1);

    const wrapper = mount(NotificationCenter, { attachTo: document.body });
    await flushPromises();

    const label = wrapper.find('button').attributes('aria-label');

    expect(label).toContain('2 open alert');
    expect(label).toContain('1 unread');
    expect(wrapper.find('button').attributes('aria-expanded')).toBe('false');
  });
});
