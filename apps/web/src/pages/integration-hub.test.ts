import type { Integration, IntegrationDetail, IntegrationProviderInfo } from '@hadiya/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import McpToolRow from '@/components/integrations/McpToolRow.vue';
import { ApiClientError } from '@/services/api-error';
import { integrationHubService } from '@/services/integration.service';
import IntegrationDetailPage from './IntegrationDetailPage.vue';
import IntegrationHubPage from './IntegrationHubPage.vue';

/**
 * The Integration Hub, against a mocked API.
 *
 * Two things are being checked, and only one of them is that the page renders.
 * The other is that nothing about a credential can reach the browser: the
 * service types have no field for one, and the assertions below check the
 * rendered output as well, because a type is a promise about the code and this
 * is a promise about the screen.
 */
let pinia: Pinia;

const router = { push: vi.fn() };

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: 'integration-1' } }),
  useRouter: () => router,
  RouterLink: { template: '<a><slot /></a>' },
}));

beforeEach(() => {
  pinia = createPinia();
  setActivePinia(pinia);
  router.push.mockReset();
});

// `BaseModal` teleports to the body, so a dialog's markup is not inside the
// wrapper. Mounting into the document is what makes it reachable, and clearing
// the body afterwards keeps one test's dialog out of the next one's queries.
afterEach(() => {
  document.body.innerHTML = '';
});

const catalogue: IntegrationProviderInfo[] = [
  {
    provider: 'billz',
    type: 'native',
    label: 'Billz',
    setupHint: 'Nothing to enter. Billz is configured once for the whole deployment.',
    description: 'The shop itself.',
    available: true,
    unavailableReason: null,
    authMethods: [],
    requiresServerUrl: false,
    requiresCredential: false,
  },
  {
    provider: 'notion',
    type: 'native',
    label: 'Notion',
    setupHint: 'You will need an internal integration token from notion.so/my-integrations.',
    description: 'Your workspace notes.',
    available: false,
    unavailableReason: 'This deployment cannot store credentials.',
    authMethods: [],
    requiresServerUrl: false,
    requiresCredential: true,
  },
  {
    provider: 'custom_mcp',
    type: 'mcp',
    label: 'Custom MCP server',
    setupHint: 'You will need the server address (https), and a token unless the server is open.',
    description: 'Connect your own tools.',
    available: true,
    unavailableReason: null,
    authMethods: ['none', 'bearer', 'header'],
    requiresServerUrl: true,
    requiresCredential: false,
  },
];

const anIntegration = (overrides: Partial<Integration> = {}): Integration => ({
  id: 'integration-1',
  user: 'user-1',
  name: 'My CRM',
  description: null,
  type: 'mcp',
  provider: 'custom_mcp',
  status: 'connected',
  enabled: true,
  config: {
    serverUrl: 'https://crm.example.com/mcp',
    transport: 'http',
    authMethod: 'bearer',
    authHeaderName: null,
  },
  hasCredentials: true,
  metadata: { server: 'crm-server' },
  lastConnectedAt: '2026-09-05T08:00:00.000Z',
  lastErrorAt: null,
  lastError: null,
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-09-05T08:00:00.000Z',
  ...overrides,
});

const aDetail = (overrides: Partial<IntegrationDetail> = {}): IntegrationDetail => ({
  ...anIntegration(),
  tools: [
    {
      name: 'search_customers',
      description: 'Search customers in the CRM.',
      inputSchema: { type: 'object' },
      risk: 'read',
      permission: 'enabled',
      discoveredAt: '2026-09-05T08:00:00.000Z',
      permissionSetAt: null,
    },
    {
      name: 'create_invoice',
      description: 'Create an invoice.',
      inputSchema: { type: 'object' },
      risk: 'write',
      permission: 'requires_confirmation',
      discoveredAt: '2026-09-05T08:00:00.000Z',
      permissionSetAt: null,
    },
    {
      name: 'delete_customer',
      description: 'Delete a customer permanently.',
      inputSchema: { type: 'object' },
      risk: 'destructive',
      permission: 'blocked',
      discoveredAt: '2026-09-05T08:00:00.000Z',
      permissionSetAt: '2026-09-05T08:05:00.000Z',
    },
  ],
  toolsRefreshedAt: '2026-09-05T08:00:00.000Z',
  ...overrides,
});

const stubHub = (integrations: Integration[]): void => {
  vi.spyOn(integrationHubService, 'list').mockResolvedValue({
    items: integrations,
    pagination: {
      page: 1,
      pageSize: 50,
      total: integrations.length,
      totalPages: 1,
      hasPrevious: false,
      hasNext: false,
    },
  });
  vi.spyOn(integrationHubService, 'catalogue').mockResolvedValue({ items: catalogue });
};

const mountHub = () =>
  mount(IntegrationHubPage, { attachTo: document.body, global: { plugins: [pinia] } });
const mountDetail = () =>
  mount(IntegrationDetailPage, { attachTo: document.body, global: { plugins: [pinia] } });

/**
 * Queries against the teleported dialog.
 *
 * `BaseModal` renders through `Teleport`, so its markup is a sibling of the
 * page rather than a descendant, and Vue Test Utils' `wrapper.find` cannot see
 * it. These reach into the document instead, which is where a real user's
 * click would land too.
 */
/**
 * The dialog panel, which is scoped by `role="dialog"` rather than by the body.
 *
 * The page is mounted into the body too, so an unscoped query would find the
 * hub's own "Add integration" button before the dialog's — and a test that
 * reopened the dialog instead of submitting it would pass for the wrong reason.
 */
const dialogPanel = (): HTMLElement => {
  const panel = document.body.querySelector<HTMLElement>('[role="dialog"]');

  if (!panel) {
    throw new Error('No dialog is open');
  }

  return panel;
};

const dialogText = (): string => dialogPanel().textContent ?? '';

const dialogElements = <TElement extends Element>(selector: string): TElement[] => [
  ...dialogPanel().querySelectorAll<TElement>(selector),
];

const clickText = async (text: string): Promise<void> => {
  const button = dialogElements<HTMLButtonElement>('button').find((node) =>
    (node.textContent ?? '').includes(text),
  );

  button?.click();
  await nextTick();
};

/** Sets a field the way a person would, so `v-model` sees the change. */
const fill = async (selector: string, value: string): Promise<void> => {
  const field = dialogElements<HTMLInputElement | HTMLSelectElement>(selector)[0];

  if (!field) {
    throw new Error(`No field matched ${selector}`);
  }

  field.value = value;
  field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? 'change' : 'input'));
  await nextTick();
};

describe('the integration hub', () => {
  it('lists what is connected', async () => {
    stubHub([anIntegration()]);

    const wrapper = mountHub();
    await flushPromises();

    expect(wrapper.text()).toContain('My CRM');
    expect(wrapper.text()).toContain('Connected');
    // The host, not the path: a path can carry a secret somebody pasted into
    // the wrong field.
    expect(wrapper.text()).toContain('crm.example.com');
    expect(wrapper.text()).not.toContain('/mcp');
  });

  it('offers to add something when there is nothing yet', async () => {
    stubHub([]);

    const wrapper = mountHub();
    await flushPromises();

    expect(wrapper.text()).toContain('Nothing connected yet');
    expect(wrapper.text()).toContain('Add your first integration');
  });

  it('separates a failing integration from a working one', async () => {
    stubHub([
      anIntegration(),
      anIntegration({
        id: 'integration-2',
        name: 'Broken CRM',
        status: 'error',
        lastError: 'The server could not be reached.',
      }),
    ]);

    const wrapper = mountHub();
    await flushPromises();

    // "Needs attention" and "Connected" call for different actions, so they are
    // different sections rather than two colours in one list.
    expect(wrapper.text()).toContain('Needs attention');
    expect(wrapper.text()).toContain('The server could not be reached.');
  });

  it('shows a loading state before anything has arrived', async () => {
    vi.spyOn(integrationHubService, 'list').mockReturnValue(new Promise(() => undefined));
    vi.spyOn(integrationHubService, 'catalogue').mockReturnValue(new Promise(() => undefined));

    const wrapper = mountHub();
    await nextTick();

    expect(wrapper.findComponent({ name: 'LoadingSkeleton' }).exists()).toBe(true);
  });

  it('shows an error state when the list cannot be read', async () => {
    vi.spyOn(integrationHubService, 'list').mockRejectedValue(
      new ApiClientError('Could not reach the server.', { code: 'NETWORK_ERROR' }),
    );
    vi.spyOn(integrationHubService, 'catalogue').mockResolvedValue({ items: catalogue });

    const wrapper = mountHub();
    await flushPromises();

    expect(wrapper.text()).toContain('Could not reach the server.');
  });
});

describe('adding an integration', () => {
  const openDialog = async (): Promise<void> => {
    const wrapper = mountHub();
    await flushPromises();

    await wrapper.find('button').trigger('click');
    await flushPromises();
  };

  it('offers only the providers the server says are available', async () => {
    stubHub([]);
    await openDialog();

    expect(dialogText()).toContain('Billz');
    expect(dialogText()).toContain('Custom MCP server');
    // Unavailable, with the reason attached rather than silently hidden.
    expect(dialogText()).toContain('This deployment cannot store credentials.');
  });

  it('offers only authentication methods the server implements', async () => {
    stubHub([]);
    await openDialog();
    await clickText('Custom MCP server');

    const options = dialogElements<HTMLOptionElement>('option').map((node) => node.textContent);

    expect(options).toContain('Bearer token');
    expect(options).toContain('Custom header');
    // Offering OAuth would produce an integration stuck forever at
    // "authentication required", because nothing implements the flow.
    expect(options.join(' ')).not.toContain('OAuth');
  });

  it('says what each provider will ask for, before it is picked', async () => {
    stubHub([]);
    await openDialog();

    // "Only asks for a name" is a fair complaint about a form that gives no
    // warning that a token is coming.
    expect(dialogText()).toContain('a token unless the server is open');
    // And the opposite case is worth saying too: Billz asks for nothing, which
    // looks like a broken form unless somebody explains it.
    expect(dialogText()).toContain('Nothing to enter');
    // An unavailable provider shows why instead — the reason is the useful
    // sentence there, not what it would have asked for.
    expect(dialogText()).toContain('This deployment cannot store credentials.');
    expect(dialogText()).not.toContain('notion.so/my-integrations');
  });

  it('asks for a token by default rather than hiding it behind "None"', async () => {
    stubHub([]);
    await openDialog();
    await clickText('Custom MCP server');

    // Most MCP servers need one, and defaulting to no authentication made the
    // form look complete while missing the only field that mattered.
    const auth = dialogElements<HTMLSelectElement>('select')[1];
    expect(auth?.value).toBe('bearer');
    expect(dialogElements<HTMLInputElement>('input[type="password"]')).toHaveLength(1);
  });

  it('sends the token once and goes to the new integration', async () => {
    stubHub([]);
    const create = vi
      .spyOn(integrationHubService, 'create')
      .mockResolvedValue(aDetail({ status: 'disconnected' }));

    await openDialog();
    await clickText('Custom MCP server');

    await fill('input[type="url"]', 'https://crm.example.com/mcp');
    // No need to touch the auth select: bearer is the default now.
    await fill('input[type="password"]', 'crm-secret-token');
    await clickText('Add integration');
    await flushPromises();

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'custom_mcp',
        serverUrl: 'https://crm.example.com/mcp',
        authMethod: 'bearer',
        secret: 'crm-secret-token',
      }),
    );

    // Creating stores the settings; the next step is proving they work.
    expect(router.push).toHaveBeenCalledWith({
      name: 'integration',
      params: { id: 'integration-1' },
    });
  });
});

describe('the integration detail page', () => {
  it('lists discovered tools with their permissions', async () => {
    vi.spyOn(integrationHubService, 'get').mockResolvedValue(aDetail());

    const wrapper = mountDetail();
    await flushPromises();

    const rows = wrapper.findAllComponents(McpToolRow);
    expect(rows).toHaveLength(3);
    expect(wrapper.text()).toContain('search_customers');
    expect(wrapper.text()).toContain('Ask me first');
    expect(wrapper.text()).toContain('Blocked');
  });

  it('never renders a credential, only whether one exists', async () => {
    vi.spyOn(integrationHubService, 'get').mockResolvedValue(aDetail());

    const wrapper = mountDetail();
    await flushPromises();

    // A sentence, not a masked field: a row of dots implies a value that could
    // be revealed, and this one never can be.
    expect(wrapper.text()).toContain('Saved and encrypted');
    expect(wrapper.html()).not.toContain('••••');
    expect(wrapper.html()).not.toContain('secret');
  });

  it('changes a tool’s permission', async () => {
    vi.spyOn(integrationHubService, 'get').mockResolvedValue(aDetail());
    const change = vi
      .spyOn(integrationHubService, 'setToolPermission')
      .mockResolvedValue(aDetail());

    const wrapper = mountDetail();
    await flushPromises();

    await wrapper.findAllComponents(McpToolRow)[0]?.find('select').setValue('blocked');
    await flushPromises();

    expect(change).toHaveBeenCalledWith('integration-1', 'search_customers', 'blocked');
  });

  it('shows a failed test as a diagnosis rather than as a broken page', async () => {
    vi.spyOn(integrationHubService, 'get').mockResolvedValue(aDetail());
    vi.spyOn(integrationHubService, 'test').mockResolvedValue({
      health: {
        status: 'error',
        healthy: false,
        message: 'The server refused the saved credential.',
        toolCount: 0,
        server: null,
        checkedAt: '2026-09-05T09:00:00.000Z',
        latencyMs: 120,
      },
      integration: aDetail({ status: 'error' }),
    });

    const wrapper = mountDetail();
    await flushPromises();

    const testButton = wrapper.findAll('button').find((node) => node.text() === 'Test connection');
    await testButton?.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('The server refused the saved credential.');
    // The tools are still listed: a failed probe is information, not a wipe.
    expect(wrapper.findAllComponents(McpToolRow).length).toBeGreaterThan(0);
  });

  it('disconnects and reports that the credential is gone', async () => {
    vi.spyOn(integrationHubService, 'get').mockResolvedValue(aDetail());
    const disconnect = vi
      .spyOn(integrationHubService, 'disconnect')
      .mockResolvedValue(aDetail({ status: 'disconnected', hasCredentials: false }));

    const wrapper = mountDetail();
    await flushPromises();

    const button = wrapper.findAll('button').find((node) => node.text() === 'Disconnect');
    await button?.trigger('click');
    await flushPromises();

    expect(disconnect).toHaveBeenCalledWith('integration-1');
    expect(wrapper.text()).toContain('None saved');
  });

  it('asks before deleting, and says what deleting costs', async () => {
    vi.spyOn(integrationHubService, 'get').mockResolvedValue(aDetail());
    const remove = vi.spyOn(integrationHubService, 'remove').mockResolvedValue(undefined);

    const wrapper = mountDetail();
    await flushPromises();

    await wrapper
      .findAll('button')
      .find((node) => node.text() === 'Delete')
      ?.trigger('click');
    await flushPromises();

    expect(dialogText()).toContain('saved credential is destroyed');
    // A mis-click on a list row must not be able to remove a connection.
    expect(remove).not.toHaveBeenCalled();

    await clickText('Delete');
    await flushPromises();

    expect(remove).toHaveBeenCalledWith('integration-1');
    expect(router.push).toHaveBeenCalledWith({ name: 'integration-hub' });
  });

  it('shows what a native integration can do instead of a permission table', async () => {
    vi.spyOn(integrationHubService, 'get').mockResolvedValue(
      aDetail({
        provider: 'billz',
        type: 'native',
        name: 'Billz',
        config: { credentialSource: 'environment' },
        tools: [],
      }),
    );

    const wrapper = mountDetail();
    await flushPromises();

    expect(wrapper.text()).toContain('never writes to Billz');
    expect(wrapper.findAllComponents(McpToolRow)).toHaveLength(0);
  });

  it('shows a loading state before the integration arrives', async () => {
    vi.spyOn(integrationHubService, 'get').mockReturnValue(new Promise(() => undefined));

    const wrapper = mountDetail();
    await nextTick();

    expect(wrapper.findComponent({ name: 'LoadingSkeleton' }).exists()).toBe(true);
  });

  it('shows an error state when the integration cannot be read', async () => {
    vi.spyOn(integrationHubService, 'get').mockRejectedValue(
      new ApiClientError('Integration not found', { code: 'NOT_FOUND', status: 404 }),
    );

    const wrapper = mountDetail();
    await flushPromises();

    expect(wrapper.text()).toContain('Integration not found');
  });
});
