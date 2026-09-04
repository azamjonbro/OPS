import type { Branch } from '@hadiya/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { branchService } from '@/services/branch.service';
import { useAuthStore } from '@/stores/auth';

const SELECTED_BRANCH_KEY = 'hadiya.ui.branchId';

/**
 * Which branch the interface is showing.
 *
 * Only meaningful for organisation-wide roles: branch-bound staff are scoped by
 * the API to their own branch regardless of what the client asks for, so for
 * them the selector is not rendered and `selectedBranchId` stays `null`. That is
 * the honest shape — sending a branch id the server will overrule would make
 * the interface look like it was doing something it was not.
 */
export const useBranchesStore = defineStore('branches', () => {
  const branches = ref<Branch[]>([]);
  const selectedBranchId = ref<string | null>(null);
  const isLoading = ref(false);
  const hasLoaded = ref(false);

  const auth = useAuthStore();

  /** Only an account not tied to one branch may choose. */
  const canChoose = computed(() => auth.user !== null && auth.user.branch === null);

  const selectedBranch = computed(
    () => branches.value.find((branch) => branch.id === selectedBranchId.value) ?? null,
  );

  /** The id to send with a request, or `undefined` to let the API decide. */
  const scopeBranchId = computed(() =>
    canChoose.value && selectedBranchId.value ? selectedBranchId.value : undefined,
  );

  const load = async (): Promise<void> => {
    if (hasLoaded.value || !canChoose.value) {
      return;
    }

    isLoading.value = true;

    try {
      const result = await branchService.list({ pageSize: 50 });
      branches.value = result.items;
      hasLoaded.value = true;

      const remembered = window.localStorage.getItem(SELECTED_BRANCH_KEY);

      if (remembered && result.items.some((branch) => branch.id === remembered)) {
        selectedBranchId.value = remembered;
      }
    } catch {
      // A failed branch list must not take the whole shell down with it; the
      // selector simply does not appear.
      branches.value = [];
    } finally {
      isLoading.value = false;
    }
  };

  const select = (branchId: string | null): void => {
    selectedBranchId.value = branchId;

    if (branchId) {
      window.localStorage.setItem(SELECTED_BRANCH_KEY, branchId);
    } else {
      window.localStorage.removeItem(SELECTED_BRANCH_KEY);
    }
  };

  const reset = (): void => {
    branches.value = [];
    selectedBranchId.value = null;
    hasLoaded.value = false;
  };

  return {
    branches,
    selectedBranchId,
    selectedBranch,
    scopeBranchId,
    canChoose,
    isLoading,
    load,
    select,
    reset,
  };
});
