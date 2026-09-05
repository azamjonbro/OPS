import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClientError } from '@/services/api-error';
import { integrationService } from '@/services/integration.service';
import IntegrationsPage from './IntegrationsPage.vue';

/**
 * The integrations screen, against mocked status endpoints.
 *
 * The cases that matter are the unhappy ones: this is the page somebody opens
 * *because* something is broken, so a failing integration must be legible and
 * must not take the rest of the page down with it.
 */
let pinia: Pinia;

beforeEach(() => {
  pinia = createPinia();
  setActivePinia(pinia);
});

const billzOk = {
  configured: true,
  connected: true,
  baseUrl: 'https://api-admin.billz.ai',
  error: null,
  checkedAt: '2026-09-05T00:00:00.000Z',
};

const assistantOk = {
  provider: 'openai',
  available: true,
  model: 'gpt-5',
  reason: null,
  tools: [
    {
      name: 'billz_get_sales_summary',
      description: '',
      mutates: false,
      requiresConfirmation: false,
    },
  ],
};

const imagesOk = {
  provider: 'openai',
  available: true,
  model: 'gpt-image-1',
  maxImagesPerRequest: 4,
  storage: 'local',
  reason: null,
};

const usageOk = {
  scope: 'own' as const,
  totals: {
    turns: 18,
    promptTokens: 77_238,
    completionTokens: 9_717,
    firstAt: '2026-09-04T17:50:29.376Z',
    lastAt: '2026-09-05T01:46:11.813Z',
  },
  byModel: [
    { model: 'gpt-5-2025-08-07', turns: 18, promptTokens: 77_238, completionTokens: 9_717 },
  ],
  conversationCount: 5,
  imageCount: 2,
  organisation: null,
};

const stubAll = () => {
  vi.spyOn(integrationService, 'billz').mockResolvedValue(billzOk);
  vi.spyOn(integrationService, 'assistant').mockResolvedValue(assistantOk);
  vi.spyOn(integrationService, 'images').mockResolvedValue(imagesOk);
  vi.spyOn(integrationService, 'usage').mockResolvedValue(usageOk);
};

const mountPage = async () => {
  const wrapper = mount(IntegrationsPage, { global: { plugins: [pinia] } });
  await flushPromises();

  return wrapper;
};

describe('connections', () => {
  it('reads each service from its own status endpoint', async () => {
    stubAll();
    const wrapper = await mountPage();

    expect(wrapper.text()).toContain('Billz');
    expect(wrapper.text()).toContain('api-admin.billz.ai');
    expect(wrapper.text()).toContain('openai · gpt-5');
    expect(wrapper.text()).toContain('gpt-image-1');
    expect(wrapper.text()).toContain('1 tools available');
  });

  it('tells "set up but failing" apart from "never set up"', async () => {
    stubAll();
    vi.spyOn(integrationService, 'billz').mockResolvedValue({
      ...billzOk,
      connected: false,
      error: 'Billz answered 405 for /v1/auth/login',
    });
    vi.spyOn(integrationService, 'images').mockResolvedValue({
      ...imagesOk,
      available: false,
      model: null,
      reason: 'no image model is configured',
    });

    const wrapper = await mountPage();

    // Two different problems needing two different fixes: one wants somebody to
    // look at why, the other wants a credential.
    expect(wrapper.text()).toContain('Not responding');
    expect(wrapper.text()).toContain('Not set up');
    expect(wrapper.text()).toContain('Billz answered 405');
  });

  it('keeps the rest of the page when one status call fails outright', async () => {
    stubAll();
    vi.spyOn(integrationService, 'billz').mockRejectedValue(
      new ApiClientError('offline', { code: 'NETWORK_ERROR' }),
    );

    const wrapper = await mountPage();

    // Billz being unreachable is the usual reason to open this page; it must
    // not be the reason the usage figures disappear.
    expect(wrapper.text()).toContain('gpt-5');
    expect(wrapper.text()).toContain('86,955');
  });
});

describe('usage', () => {
  it('totals what was sent and received, and names the model', async () => {
    stubAll();
    const wrapper = await mountPage();

    expect(wrapper.text()).toContain('86,955');
    expect(wrapper.text()).toContain('gpt-5-2025-08-07');
    expect(wrapper.text()).toContain('5');
  });

  it('never shows money, and says why the balance is absent', async () => {
    stubAll();
    const wrapper = await mountPage();

    // The rate depends on a plan this server does not know; a figure here would
    // look authoritative and be wrong.
    expect(wrapper.text()).not.toMatch(/\$\d/);
    expect(wrapper.text()).toContain('reveals it only to its own billing page');
    expect(wrapper.find('a[href*="billing"]').exists()).toBe(true);
  });

  it('shows the organisation total to somebody allowed one', async () => {
    stubAll();
    vi.spyOn(integrationService, 'usage').mockResolvedValue({
      ...usageOk,
      organisation: {
        totals: {
          turns: 40,
          promptTokens: 200_000,
          completionTokens: 20_000,
          firstAt: null,
          lastAt: null,
        },
        conversationCount: 12,
        imageCount: 6,
      },
    });

    const wrapper = await mountPage();

    expect(wrapper.text()).toContain('Across everyone');
    expect(wrapper.text()).toContain('220,000');
  });
});
