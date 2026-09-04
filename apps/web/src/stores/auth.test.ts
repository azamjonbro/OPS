import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { authService } from '@/services/auth.service';
import { tokenStorage } from '@/services/token-storage';
import { useAuthStore } from '@/stores/auth';
import { makeUser } from '@/test/factories';

beforeEach(() => {
  setActivePinia(createPinia());
  tokenStorage.clear();
});

describe('login state', () => {
  it('stores the tokens and the account on a successful sign-in', async () => {
    const user = makeUser();
    vi.spyOn(authService, 'login').mockResolvedValue({
      user,
      tokens: { accessToken: 'a', refreshToken: 'r', expiresIn: 900 },
    });

    const auth = useAuthStore();
    await auth.login({ username: 'manager', password: 'secret' });

    expect(auth.isAuthenticated).toBe(true);
    expect(auth.user?.fullName).toBe(user.fullName);
    expect(tokenStorage.read()?.accessToken).toBe('a');
  });

  it('is not authenticated on a token alone until the account is known', () => {
    tokenStorage.write({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 });
    const auth = useAuthStore();

    // A token that has not been exchanged for an account could be anything.
    expect(auth.hasToken).toBe(true);
    expect(auth.isAuthenticated).toBe(false);
  });

  it('rehydrates the session from a stored token', async () => {
    tokenStorage.write({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 });
    vi.spyOn(authService, 'currentUser').mockResolvedValue(makeUser());

    const auth = useAuthStore();
    await auth.restore();

    expect(auth.isAuthenticated).toBe(true);
  });

  it('clears everything on sign-out, even when the server call fails', async () => {
    tokenStorage.write({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 });
    vi.spyOn(authService, 'logout').mockRejectedValue(new Error('offline'));

    const auth = useAuthStore();
    auth.user = makeUser();

    await auth.logout();

    // Signing out must work offline; the tokens are the client's to discard.
    expect(auth.isAuthenticated).toBe(false);
    expect(tokenStorage.read()).toBeNull();
  });
});
