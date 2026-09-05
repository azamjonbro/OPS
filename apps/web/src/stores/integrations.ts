import type {
  Integration,
  IntegrationDetail,
  IntegrationHealth,
  IntegrationProviderInfo,
  McpToolPermission,
} from '@hadiya/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { toErrorMessage } from '@/services/api-error';
import {
  integrationHubService,
  type CreateIntegrationPayload,
  type UpdateIntegrationPayload,
} from '@/services/integration.service';

/**
 * What this account has connected.
 *
 * Everything here comes from the API and nothing is derived from a credential,
 * because the client never receives one. `hasCredentials` is the only thing the
 * browser is told about a secret — whether one exists — which is why this store
 * can be inspected in a devtools panel without consequence.
 *
 * Loading and saving are tracked separately: the list must not blank while a
 * connection test is running, since watching the state change *is* the point of
 * pressing the button.
 */
export const useIntegrationsStore = defineStore('integrations', () => {
  const integrations = ref<Integration[]>([]);
  const catalogue = ref<IntegrationProviderInfo[]>([]);
  const current = ref<IntegrationDetail | null>(null);
  /** The result of the last test or connect, shown beside the button. */
  const lastHealth = ref<IntegrationHealth | null>(null);

  const isLoading = ref(false);
  const isSaving = ref(false);
  /** True while a connection is being opened, which can take seconds. */
  const isConnecting = ref(false);
  const error = ref<string | null>(null);

  const connected = computed(() =>
    integrations.value.filter((item) => item.enabled && item.status === 'connected'),
  );

  const hasAny = computed(() => integrations.value.length > 0);

  /**
   * Runs one API call, tracking a flag and turning any failure into a message.
   *
   * The same shape as the other stores: nothing throws out of an action, so a
   * component never needs a try/catch and an unhandled rejection cannot take
   * the page down.
   */
  const run = async <TResult>(
    flag: { value: boolean },
    action: () => Promise<TResult>,
  ): Promise<TResult | null> => {
    flag.value = true;
    error.value = null;

    try {
      return await action();
    } catch (caught) {
      error.value = toErrorMessage(caught);

      return null;
    } finally {
      flag.value = false;
    }
  };

  const load = async (): Promise<void> => {
    const result = await run(isLoading, async () => {
      // Settled rather than all: the catalogue failing should not blank the
      // list of things already connected, which is what somebody came to see.
      const [list, providers] = await Promise.allSettled([
        integrationHubService.list(),
        integrationHubService.catalogue(),
      ]);

      return { list, providers };
    });

    if (!result) {
      return;
    }

    if (result.list.status === 'fulfilled') {
      integrations.value = result.list.value.items;
    }

    if (result.providers.status === 'fulfilled') {
      catalogue.value = result.providers.value.items;
    }

    if (result.list.status === 'rejected') {
      error.value = toErrorMessage(result.list.reason);
    }
  };

  const open = async (id: string): Promise<void> => {
    const detail = await run(isLoading, () => integrationHubService.get(id));

    if (detail) {
      current.value = detail;
      lastHealth.value = null;
    }
  };

  /** Replaces the copy in the list, so the hub reflects a detail-page change. */
  const absorb = (detail: IntegrationDetail): void => {
    current.value = detail;

    const index = integrations.value.findIndex((item) => item.id === detail.id);

    if (index >= 0) {
      integrations.value.splice(index, 1, detail);
    } else {
      integrations.value.unshift(detail);
    }
  };

  const create = async (payload: CreateIntegrationPayload): Promise<IntegrationDetail | null> => {
    const created = await run(isSaving, () => integrationHubService.create(payload));

    if (created) {
      absorb(created);
    }

    return created;
  };

  const update = async (
    id: string,
    payload: UpdateIntegrationPayload,
  ): Promise<IntegrationDetail | null> => {
    const updated = await run(isSaving, () => integrationHubService.update(id, payload));

    if (updated) {
      absorb(updated);
    }

    return updated;
  };

  /**
   * Connect, test and refresh share a shape: they return a health verdict and
   * the integration as it now stands.
   *
   * A failed probe is not an error — the endpoint answers 200 with the reason —
   * so `error` stays null and the diagnosis is shown as content. That is the
   * difference between "your CRM is unreachable" and "Hadiya is broken", and
   * conflating them is what makes a status page useless.
   */
  const probe = async (
    id: string,
    action: 'connect' | 'test' | 'refresh',
  ): Promise<IntegrationHealth | null> => {
    const result = await run(isConnecting, () => integrationHubService[action](id));

    if (result) {
      absorb(result.integration);
      lastHealth.value = result.health;
    }

    return result?.health ?? null;
  };

  const connect = (id: string): Promise<IntegrationHealth | null> => probe(id, 'connect');
  const test = (id: string): Promise<IntegrationHealth | null> => probe(id, 'test');
  const refresh = (id: string): Promise<IntegrationHealth | null> => probe(id, 'refresh');

  const disconnect = async (id: string): Promise<void> => {
    const updated = await run(isConnecting, () => integrationHubService.disconnect(id));

    if (updated) {
      absorb(updated);
      lastHealth.value = null;
    }
  };

  const remove = async (id: string): Promise<boolean> => {
    const removed = await run(isSaving, async () => {
      await integrationHubService.remove(id);

      return true;
    });

    if (removed) {
      integrations.value = integrations.value.filter((item) => item.id !== id);

      if (current.value?.id === id) {
        current.value = null;
      }
    }

    return removed === true;
  };

  const setToolPermission = async (
    id: string,
    tool: string,
    permission: McpToolPermission,
  ): Promise<void> => {
    const updated = await run(isSaving, () =>
      integrationHubService.setToolPermission(id, tool, permission),
    );

    if (updated) {
      absorb(updated);
    }
  };

  return {
    integrations,
    catalogue,
    current,
    lastHealth,
    isLoading,
    isSaving,
    isConnecting,
    error,
    connected,
    hasAny,
    load,
    open,
    create,
    update,
    connect,
    test,
    refresh,
    disconnect,
    remove,
    setToolPermission,
  };
});
