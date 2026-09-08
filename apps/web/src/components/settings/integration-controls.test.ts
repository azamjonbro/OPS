import type { Integration, IntegrationHealth } from '@hadiya/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { integrationHubService } from '@/services/integration.service';
import IntegrationControls from './IntegrationControls.vue';

/**
 * The controls a person reaches for in Settings when something stopped working.
 *
 * The point of the assertions is which call each button makes: "switch off" is
 * a settings change, "stop" drops the connection, and only "change credential"
 * may carry a secret. A test that merely counted the buttons would let them be
 * wired to each other's endpoints, which is precisely the mistake that would
 * throw away a stored password when somebody meant to pause an integration.
 */
vi.mock('vue-router', () => ({
  RouterLink: { template: '<a><slot /></a>' },
}));

let pinia: Pinia;

const anIntegration = (overrides: Partial<Integration> = {}): Integration => ({
  id: 'integration-1',
  user: 'user-1',
  name: 'Shop mail',
  description: null,
  type: 'native',
  provider: 'icloud_mail',
  status: 'connected',
  enabled: true,
  config: { credentialSource: 'stored', options: { email: 'shop@icloud.com' } },
  hasCredentials: true,
  metadata: {},
  lastConnectedAt: '2026-09-08T08:00:00.000Z',
  lastErrorAt: null,
  lastError: null,
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-09-08T08:00:00.000Z',
  ...overrides,
});

const health: IntegrationHealth = {
  status: 'connected',
  healthy: true,
  message: 'Signed in as shop@icloud.com. INBOX holds 12 messages, 3 unread.',
  toolCount: 0,
  server: { name: 'imap.mail.me.com', version: 'IMAP4rev1' },
  checkedAt: '2026-09-08T09:00:00.000Z',
  latencyMs: 420,
};

const stubList = (items: Integration[]): void => {
  vi.spyOn(integrationHubService, 'list').mockResolvedValue({
    items,
    pagination: {
      page: 1,
      pageSize: 50,
      total: items.length,
      totalPages: 1,
      hasPrevious: false,
      hasNext: false,
    },
  });
  vi.spyOn(integrationHubService, 'catalogue').mockResolvedValue({ items: [] });
};

const mountControls = async () => {
  const wrapper = mount(IntegrationControls, { global: { plugins: [pinia] } });

  await flushPromises();

  return wrapper;
};

const buttonNamed = (wrapper: Awaited<ReturnType<typeof mountControls>>, label: string) => {
  const button = wrapper.findAll('button').find((candidate) => candidate.text().trim() === label);

  if (!button) {
    throw new Error(`No button labelled "${label}"`);
  }

  return button;
};

beforeEach(() => {
  pinia = createPinia();
  setActivePinia(pinia);
  vi.restoreAllMocks();
});

describe('the connection controls in Settings', () => {
  it('runs a health check and shows what came back', async () => {
    stubList([anIntegration()]);
    const test = vi.spyOn(integrationHubService, 'test').mockResolvedValue({
      health,
      integration: { ...anIntegration(), tools: [], toolsRefreshedAt: null },
    });

    const wrapper = await mountControls();

    await buttonNamed(wrapper, 'Check').trigger('click');
    await flushPromises();

    expect(test).toHaveBeenCalledWith('integration-1');
    expect(wrapper.text()).toContain('INBOX holds 12 messages');
  });

  it('switches an integration off through its settings, not by disconnecting it', async () => {
    stubList([anIntegration()]);
    const update = vi.spyOn(integrationHubService, 'update').mockResolvedValue({
      ...anIntegration({ enabled: false }),
      tools: [],
      toolsRefreshedAt: null,
    });
    const disconnect = vi.spyOn(integrationHubService, 'disconnect');

    const wrapper = await mountControls();

    await buttonNamed(wrapper, 'Switch off').trigger('click');
    await flushPromises();

    expect(update).toHaveBeenCalledWith('integration-1', { enabled: false });
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('stops a connection through disconnect', async () => {
    stubList([anIntegration()]);
    const disconnect = vi.spyOn(integrationHubService, 'disconnect').mockResolvedValue({
      ...anIntegration({ status: 'disconnected' }),
      tools: [],
      toolsRefreshedAt: null,
    });

    const wrapper = await mountControls();

    await buttonNamed(wrapper, 'Stop').trigger('click');
    await flushPromises();

    expect(disconnect).toHaveBeenCalledWith('integration-1');
  });

  it('sends a replacement credential and never renders it back', async () => {
    stubList([anIntegration()]);
    const update = vi
      .spyOn(integrationHubService, 'update')
      .mockResolvedValue({ ...anIntegration(), tools: [], toolsRefreshedAt: null });

    const wrapper = await mountControls();

    await buttonNamed(wrapper, 'Change credential').trigger('click');

    const inputs = wrapper.findAll('input');

    await inputs[0]?.setValue('new@icloud.com');
    await inputs[1]?.setValue('abcd-efgh-ijkl-mnop');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(update).toHaveBeenCalledWith('integration-1', {
      secret: 'abcd-efgh-ijkl-mnop',
      options: { email: 'new@icloud.com' },
    });
    // The form closes on success, so the password is not left in the DOM.
    expect(wrapper.html()).not.toContain('abcd-efgh-ijkl-mnop');
  });

  it('offers a way to connect something when the account has nothing', async () => {
    stubList([]);

    const wrapper = await mountControls();

    expect(wrapper.text()).toContain('Nothing is connected yet');
  });
});

/**
 * The one field the add-integration form has that no other provider needs.
 *
 * An app-specific password says nothing about which mailbox it opens, so the
 * address is asked for separately and travels as a plain option — it is not a
 * secret, and pretending it were would mean a person could never see which
 * mailbox they had connected.
 */
describe('adding iCloud Mail', () => {
  it('asks for the Apple ID as well as the password', async () => {
    const { default: AddIntegrationDialog } =
      await import('@/components/integrations/AddIntegrationDialog.vue');

    const wrapper = mount(AddIntegrationDialog, {
      attachTo: document.body,
      props: {
        open: true,
        catalogue: [
          {
            provider: 'icloud_mail' as const,
            type: 'native' as const,
            label: 'iCloud Mail',
            description: 'Your iCloud mailbox over IMAP.',
            available: true,
            unavailableReason: null,
            setupHint: 'You will need an app-specific password.',
            authMethods: [],
            requiresServerUrl: false,
            requiresCredential: true,
          },
        ],
      },
      global: { plugins: [pinia] },
    });

    const panel = document.body.querySelector<HTMLElement>('[role="dialog"]');

    expect(panel).not.toBeNull();

    const choose = [...(panel?.querySelectorAll('button') ?? [])].find((button) =>
      button.textContent?.includes('iCloud Mail'),
    );

    choose?.click();
    await flushPromises();

    const fields = [...(panel?.querySelectorAll('input') ?? [])];
    const email = fields.find((field) => field.type === 'email');
    const password = fields.find((field) => field.type === 'password');

    expect(email).toBeDefined();
    expect(password).toBeDefined();

    email!.value = 'shop@icloud.com';
    email!.dispatchEvent(new Event('input'));
    password!.value = 'abcd-efgh-ijkl-mnop';
    password!.dispatchEvent(new Event('input'));
    await flushPromises();

    const submit = [...(panel?.parentElement?.querySelectorAll('button') ?? [])].find((button) =>
      /connect|add|save/i.test(button.textContent ?? ''),
    );

    submit?.click();
    await flushPromises();

    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({
      provider: 'icloud_mail',
      secret: 'abcd-efgh-ijkl-mnop',
      options: { email: 'shop@icloud.com' },
    });

    wrapper.unmount();
    document.body.innerHTML = '';
  });
});
