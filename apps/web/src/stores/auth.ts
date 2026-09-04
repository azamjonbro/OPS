import type { LoginCredentials, User } from '@hadiya/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { authService } from '@/services/auth.service';
import { setSessionExpiredHandler } from '@/services/http';
import { tokenStorage } from '@/services/token-storage';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null);
  const hasToken = ref(tokenStorage.read() !== null);
  const isRestoring = ref(false);

  const isAuthenticated = computed(() => hasToken.value && user.value !== null);

  const clearSession = (): void => {
    tokenStorage.clear();
    hasToken.value = false;
    user.value = null;
  };

  /**
   * The transport tells the store when a refresh has failed, rather than the
   * other way round: the store already imports the HTTP layer, so importing it
   * back would close a cycle. The router guard then does the redirecting, which
   * keeps navigation decisions out of an interceptor.
   */
  setSessionExpiredHandler(clearSession);

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

  /** Re-reads the account after a setting has changed server-side. */
  const refreshUser = async (): Promise<void> => {
    if (!hasToken.value) {
      return;
    }

    user.value = await authService.currentUser();
  };

  return {
    user,
    hasToken,
    isRestoring,
    isAuthenticated,
    login,
    logout,
    restore,
    refreshUser,
    clearSession,
  };
});
