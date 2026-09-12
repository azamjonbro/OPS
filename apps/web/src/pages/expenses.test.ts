import type { ExpenseSummary } from '@hadiya/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetToasts } from '@/composables/useToast';
import { expenseService } from '@/services/expense.service';
import { makeExpense, paginated } from '@/test/factories';
import ExpensesPage from './ExpensesPage.vue';

/**
 * The expense ledger, against a mocked API.
 *
 * The thing worth checking is the money boundary: a person types whole so'm,
 * the API is sent tiyin, and what comes back in tiyin is shown as so'm again.
 * A slip on either side is a hundredfold error in the month's total, and it
 * would be invisible in a test that only checked the page renders.
 */
vi.mock('vue-router', () => ({
  RouterLink: { template: '<a><slot /></a>' },
}));

/** Intl separates thousands with a narrow no-break space; the test reads plain ones. */
const plain = (text: string): string => text.replace(/[\u00a0\u202f]/g, ' ');

const aSummary = (overrides: Partial<ExpenseSummary> = {}): ExpenseSummary => ({
  period: { from: '2026-09-01', to: '2026-09-30', label: 'Shu oy' },
  currency: 'UZS',
  total: 350_000_000,
  count: 2,
  byCategory: [
    { category: 'rent', total: 300_000_000, count: 1, share: 85.7 },
    { category: 'utilities', total: 50_000_000, count: 1, share: 14.3 },
  ],
  daily: [],
  ...overrides,
});

beforeEach(() => {
  setActivePinia(createPinia());
  resetToasts();
  vi.spyOn(expenseService, 'summary').mockResolvedValue(aSummary());
  vi.spyOn(expenseService, 'list').mockResolvedValue(
    paginated([
      makeExpense({ vendor: 'Ali aka', amount: 300_000_000 }),
      makeExpense({ category: 'utilities', note: 'Elektr', amount: 50_000_000 }),
    ]),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('ExpensesPage', () => {
  it('shows the ledger in so‘m, not in the tiyin the API speaks', async () => {
    const wrapper = mount(ExpensesPage);
    await flushPromises();

    const list = plain(wrapper.get('[data-testid="expense-list"]').text());
    expect(list).toContain('Ijara');
    expect(list).toContain('Ali aka');
    expect(list).toContain('3 000 000');
    expect(list).not.toContain('300 000 000');

    const summary = plain(wrapper.get('[data-testid="expense-summary"]').text());
    expect(summary).toContain('3 500 000');
    expect(summary).toContain('2 ta yozuv');
    expect(summary).toContain('Ijara');
  });

  it('sends what was typed in so‘m to the API in tiyin', async () => {
    const create = vi
      .spyOn(expenseService, 'create')
      .mockResolvedValue(makeExpense({ amount: 12_000_000 }));

    const wrapper = mount(ExpensesPage);
    await flushPromises();

    await wrapper.get('input[inputmode="numeric"]').setValue('120 000');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 12_000_000, category: 'goods', paymentMethod: 'cash' }),
    );
    // The ledger and the totals are re-read rather than patched locally.
    expect(expenseService.list).toHaveBeenCalledTimes(2);
    expect(expenseService.summary).toHaveBeenCalledTimes(2);
  });

  it('refuses an amount that is not a whole number of so‘m without calling the API', async () => {
    const create = vi.spyOn(expenseService, 'create');

    const wrapper = mount(ExpensesPage);
    await flushPromises();

    await wrapper.get('input[inputmode="numeric"]').setValue('12.5');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(create).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('butun so‘mda');
  });

  it('removes a row only after the dialog confirms it', async () => {
    const remove = vi.spyOn(expenseService, 'remove').mockResolvedValue(makeExpense());

    const wrapper = mount(ExpensesPage, { attachTo: document.body });
    await flushPromises();

    await wrapper.get('[data-testid="expense-list"] button').trigger('click');
    await flushPromises();
    expect(remove).not.toHaveBeenCalled();

    const confirm = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'O‘chirish' && !wrapper.element.contains(button),
    );
    expect(confirm).toBeDefined();

    confirm?.click();
    await flushPromises();

    expect(remove).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
});
