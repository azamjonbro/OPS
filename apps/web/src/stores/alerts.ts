import type { AlertSummary, BusinessAlert } from '@hadiya/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { toErrorMessage } from '@/services/api-error';
import { alertService } from '@/services/alert.service';

/**
 * Open business alerts, and the badge that goes with them.
 *
 * The summary is tracked separately from the list for the same reason the
 * inbox does it: the badge sits on every screen, and pulling the whole list to
 * find out whether it should be lit would not be cheap enough for that.
 *
 * Acknowledging and dismissing update the local copy from the server's reply
 * rather than guessing at the new state, so the card cannot drift out of step
 * with what was actually stored.
 */
export const useAlertsStore = defineStore('alerts', () => {
  const alerts = ref<BusinessAlert[]>([]);
  const summary = ref<AlertSummary | null>(null);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  const activeCount = computed(() => summary.value?.active ?? 0);
  const hasCritical = computed(
    () => (summary.value?.bySeverity.critical ?? 0) + (summary.value?.bySeverity.high ?? 0) > 0,
  );

  const run = async <TResult>(action: () => Promise<TResult>): Promise<TResult | null> => {
    error.value = null;

    try {
      return await action();
    } catch (caught) {
      error.value = toErrorMessage(caught);

      return null;
    }
  };

  const refreshSummary = async (): Promise<void> => {
    const result = await run(() => alertService.summary());

    if (result) {
      summary.value = result;
    }
  };

  const load = async (activeOnly = true): Promise<void> => {
    isLoading.value = true;

    try {
      const result = await run(() => alertService.list({ pageSize: 20, activeOnly }));

      if (result) {
        alerts.value = result.items;
        await refreshSummary();
      }
    } finally {
      isLoading.value = false;
    }
  };

  /** Both actions take an alert off the open list, so they share a path. */
  const settle = async (
    id: string,
    action: (id: string) => Promise<BusinessAlert>,
  ): Promise<void> => {
    const updated = await run(() => action(id));

    if (!updated) {
      return;
    }

    alerts.value = alerts.value.map((entry) => (entry.id === id ? updated : entry));
    await refreshSummary();
  };

  const acknowledge = (id: string): Promise<void> => settle(id, alertService.acknowledge);
  const dismiss = (id: string): Promise<void> => settle(id, alertService.dismiss);

  const reset = (): void => {
    alerts.value = [];
    summary.value = null;
    error.value = null;
  };

  return {
    alerts,
    summary,
    isLoading,
    error,
    activeCount,
    hasCritical,
    load,
    refreshSummary,
    acknowledge,
    dismiss,
    reset,
  };
});
