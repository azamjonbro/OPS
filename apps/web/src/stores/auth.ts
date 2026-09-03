import type { AuthenticatedUser, LoginCredentials } from '@hadiya/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { authService } from '@/services/auth.service';
import { tokenStorage } from '@/services/token-storage';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthenticatedUser | null>(null);
  const hasToken = ref(tokenStorage.read() !== null);
  const isRestoring = ref(false);

  const isAuthenticated = computed(() => hasToken.value && user.value !== null);

  const clearSession = (): void => {
    tokenStorage.clear();
    hasToken.value = false;
    user.value = null;
  };

  const login = async (credentials: LoginCredentials): Promise<void> => {
    const result = await authService.login(credentials);

    tokenStorage.write(result.tokens);
    hasToken.value = true;
    user.value = result.user;
  };

  const logout = async (): Promise<void> => {
    try {
      await authService.logout();
    } finally {
      clearSession();
    }
  };

  /** Rehydrates the session from a stored token on a full page load. */
  const restore = async (): Promise<void> => {
    if (!hasToken.value || user.value !== null || isRestoring.value) {
      return;
    }

    isRestoring.value = true;

    try {
      user.value = await authService.currentUser();
    } catch {
      clearSession();
    } finally {
      isRestoring.value = false;
    }
  };

  return { user, hasToken, isRestoring, isAuthenticated, login, logout, restore, clearSession };
});
