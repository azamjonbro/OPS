import type {
  ContentItem,
  ContentPlan,
  ContentPlanDetail,
  ContentPlanStatus,
} from '@hadiya/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { toErrorMessage } from '@/services/api-error';
import {
  contentService,
  type ContentItemPayload,
  type CreatePlanPayload,
  type GeneratePlanPayload,
  type UpdateItemPayload,
} from '@/services/content.service';

/**
 * Content state for the UI.
 *
 * Three flags rather than one, because they mean different things on screen:
 * `isLoading` blanks a list, `isSaving` disables a form, and `isGenerating` can
 * run for many seconds while the rest of the page stays usable. Collapsing them
 * would make an edit look like a page load.
 *
 * Item edits update the open plan in place instead of refetching it: the API
 * returns the changed item, and a whole-plan reload would scroll the person
 * away from the day they were working on.
 */
export const useContentStore = defineStore('content', () => {
  const plans = ref<ContentPlan[]>([]);
  const plan = ref<ContentPlanDetail | null>(null);

  const isLoading = ref(false);
  const isSaving = ref(false);
  const isGenerating = ref(false);
  const error = ref<string | null>(null);

  const hasPlans = computed(() => plans.value.length > 0);
  const items = computed(() => plan.value?.items ?? []);

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

  const loadPlans = async (status?: ContentPlanStatus): Promise<void> => {
    const result = await run(isLoading, () =>
      contentService.listPlans({ pageSize: 20, ...(status ? { status } : {}) }),
    );

    if (result) {
      plans.value = result.items;
    }
  };

  const loadPlan = async (id: string): Promise<void> => {
    const result = await run(isLoading, () => contentService.getPlan(id));

    if (result) {
      plan.value = result;
    }
  };

  const createPlan = async (payload: CreatePlanPayload): Promise<ContentPlan | null> => {
    const created = await run(isSaving, () => contentService.createPlan(payload));

    if (created) {
      plans.value = [created, ...plans.value];
    }

    return created;
  };

  /** Asks the assistant for a plan. Slow enough to need its own flag. */
  const generatePlan = async (payload: GeneratePlanPayload): Promise<ContentPlan | null> => {
    const result = await run(isGenerating, () => contentService.generatePlan(payload));

    if (result?.plan) {
      plans.value = [result.plan, ...plans.value];
    }

    return result?.plan ?? null;
  };

  const updatePlan = async (id: string, payload: Partial<CreatePlanPayload>): Promise<void> => {
    const updated = await run(isSaving, () => contentService.updatePlan(id, payload));

    if (updated) {
      plans.value = plans.value.map((entry) => (entry.id === id ? updated : entry));

      if (plan.value?.id === id) {
        plan.value = { ...plan.value, ...updated };
      }
    }
  };

  const deletePlan = async (id: string): Promise<void> => {
    const done = await run(isSaving, async () => {
      await contentService.deletePlan(id);

      return true;
    });

    if (done) {
      plans.value = plans.value.filter((entry) => entry.id !== id);

      if (plan.value?.id === id) {
        plan.value = null;
      }
    }
  };

  /** Keeps the open plan's days in date order after one is added or changed. */
  const withItems = (next: ContentItem[]): ContentPlanDetail | null =>
    plan.value
      ? {
          ...plan.value,
          items: [...next].sort((left, right) => left.date.localeCompare(right.date)),
          itemCount: next.length,
        }
      : null;

  const addItem = async (planId: string, payload: ContentItemPayload): Promise<void> => {
    const created = await run(isSaving, () => contentService.addItem(planId, payload));

    if (created && plan.value?.id === planId) {
      plan.value = withItems([...plan.value.items, created]);
    }
  };

  const updateItem = async (id: string, payload: UpdateItemPayload): Promise<void> => {
    const updated = await run(isSaving, () => contentService.updateItem(id, payload));

    if (updated && plan.value) {
      plan.value = withItems(plan.value.items.map((entry) => (entry.id === id ? updated : entry)));
    }
  };

  const regenerateItem = async (id: string, instruction?: string): Promise<void> => {
    const result = await run(isGenerating, () =>
      contentService.regenerateItem(id, instruction ? { instruction } : {}),
    );

    if (result && plan.value) {
      plan.value = withItems(
        plan.value.items.map((entry) => (entry.id === id ? result.item : entry)),
      );
    }
  };

  const deleteItem = async (id: string): Promise<void> => {
    const done = await run(isSaving, async () => {
      await contentService.deleteItem(id);

      return true;
    });

    if (done && plan.value) {
      plan.value = withItems(plan.value.items.filter((entry) => entry.id !== id));
    }
  };

  const reset = (): void => {
    plans.value = [];
    plan.value = null;
    error.value = null;
  };

  return {
    plans,
    plan,
    items,
    hasPlans,
    isLoading,
    isSaving,
    isGenerating,
    error,
    loadPlans,
    loadPlan,
    createPlan,
    generatePlan,
    updatePlan,
    deletePlan,
    addItem,
    updateItem,
    regenerateItem,
    deleteItem,
    reset,
  };
});
