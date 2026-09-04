import { setActivePinia, createPinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { authService } from '@/services/auth.service';
import { tokenStorage } from '@/services/token-storage';
import { useAuthStore } from '@/stores/auth';
import { makeUser } from '@/test/factories';
import { createAppRouter } from './index';

/**
 * The guard, which is the only thing standing between a bookmark and a screen
 * full of 401s. Not security — the API is what refuses — but the difference
 * between being sent to the login page and being shown a broken application.
 */
const signedIn = (role: 'cashier' | 'manager' = 'manager') => {
  tokenStorage.write({ accessToken: 'access', refreshToken: 'refresh', expiresIn: 900 });
  vi.spyOn(authService, 'currentUser').mockResolvedValue(makeUser({ role }));
};

beforeEach(() => {
  setActivePinia(createPinia());
  tokenStorage.clear();
});

describe('protected routes', () => {
  it('sends an anonymous visitor to the login page, remembering where they were going', async () => {
    const router = createAppRouter();

    await router.push('/products');
    await router.isReady();

    expect(router.currentRoute.value.name).toBe('login');
    expect(router.currentRoute.value.query.redirect).toBe('/products');
  });

  it('lets a signed-in employee through', async () => {
    signedIn();
    const router = createAppRouter();

    await router.push('/products');
    await router.isReady();

    expect(router.currentRoute.value.name).toBe('products');
  });

  it('keeps a signed-in employee off the login page', async () => {
    signedIn();
    const router = createAppRouter();
    // Establish the session first, exactly as a real reload would.
    await router.push('/');
    await router.push('/auth/login');

    expect(router.currentRoute.value.name).toBe('dashboard');
  });

  it('clears the session when the stored token is no longer accepted', async () => {
    tokenStorage.write({ accessToken: 'stale', refreshToken: 'stale', expiresIn: 900 });
    vi.spyOn(authService, 'currentUser').mockRejectedValue(new Error('401'));

    const router = createAppRouter();
    await router.push('/products');

    const auth = useAuthStore();
    expect(auth.isAuthenticated).toBe(false);
    expect(tokenStorage.read()).toBeNull();
    expect(router.currentRoute.value.name).toBe('login');
  });
});

describe('role-based routes', () => {
  it('turns a cashier away from reports', async () => {
    signedIn('cashier');
    const router = createAppRouter();

    await router.push('/reports');

    // The API would refuse anyway; this is so they never see the refusal.
    expect(router.currentRoute.value.name).toBe('dashboard');
  });

  it('lets a manager in', async () => {
    signedIn('manager');
    const router = createAppRouter();

    await router.push('/reports');

    expect(router.currentRoute.value.name).toBe('reports');
  });
});
