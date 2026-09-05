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

    await router.push('/reminders');
    await router.isReady();

    expect(router.currentRoute.value.name).toBe('login');
    expect(router.currentRoute.value.query.redirect).toBe('/reminders');
  });

  it('lets a signed-in employee through', async () => {
    signedIn();
    const router = createAppRouter();

    await router.push('/reminders');
    await router.isReady();

    expect(router.currentRoute.value.name).toBe('reminders');
  });

  it('keeps a signed-in employee off the login page', async () => {
    signedIn();
    const router = createAppRouter();
    // Establish the session first, exactly as a real reload would.
    await router.push('/');
    await router.push('/auth/login');

    expect(router.currentRoute.value.name).toBe('assistant');
  });

  it('clears the session when the stored token is no longer accepted', async () => {
    tokenStorage.write({ accessToken: 'stale', refreshToken: 'stale', expiresIn: 900 });
    vi.spyOn(authService, 'currentUser').mockRejectedValue(new Error('401'));

    const router = createAppRouter();
    await router.push('/reminders');

    const auth = useAuthStore();
    expect(auth.isAuthenticated).toBe(false);
    expect(tokenStorage.read()).toBeNull();
    expect(router.currentRoute.value.name).toBe('login');
  });
});

describe('where signing in lands', () => {
  it('opens the assistant rather than a menu of screens', async () => {
    signedIn();
    const router = createAppRouter();

    await router.push('/');
    await router.isReady();

    // Hadiya is the product; the first thing it should offer is a question box.
    expect(router.currentRoute.value.name).toBe('assistant');
  });

  it('carries a bookmarked conversation id through the guard', async () => {
    signedIn();
    const router = createAppRouter();

    await router.push('/assistant/aaaaaaaaaaaaaaaaaaaaaaaa');
    await router.isReady();

    expect(router.currentRoute.value.name).toBe('assistant-conversation');
    expect(router.currentRoute.value.params.id).toBe('aaaaaaaaaaaaaaaaaaaaaaaa');
  });

  it('has no route left for a screen Billz owns', async () => {
    signedIn();
    const router = createAppRouter();

    for (const gone of ['/products', '/sales', '/inventory', '/customers', '/expenses', '/pos']) {
      await router.push(gone);

      expect(router.currentRoute.value.name).toBe('not-found');
    }
  });
});
