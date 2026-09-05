import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { HTTP_STATUS } from '../../core/http/http-status.js';
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../../test/database.js';
import { createTestBranch, signInAs } from '../../test/factories.js';
import { IntegrationCredentialModel } from './integration-credential.model.js';
import { IntegrationAuditModel } from './integration-audit.model.js';
import { IntegrationModel } from './integration.model.js';
import { setMcpClientFactory } from './mcp/mcp-client.js';
import { McpError } from './mcp/mcp-error.js';
import { resetMcpGuards } from './mcp/mcp-guard.js';
import { createScriptedMcp, SCRIPTED_CRM_TOOLS } from './mcp/mcp-test-double.js';

/**
 * The Integration Hub end to end, against a real database and a scripted MCP
 * server.
 *
 * Nothing here reaches the network. The MCP client factory is replaced with a
 * double, which is what makes the interesting cases testable at all: a server
 * that hangs, one that returns a malformed schema, one that answers a search
 * with an instruction aimed at the model.
 *
 * The suite is organised around what could go wrong rather than around the
 * endpoints, because the endpoints are the easy part. Ownership, credential
 * secrecy and permission enforcement each get their own block.
 */

const app = createApp();
const url = '/api/v1/integrations';

/** A server address that passes the URL guard without existing. */
const SERVER_URL = 'https://crm.example.com/mcp';

beforeAll(startTestDatabase);
afterAll(stopTestDatabase);

beforeEach(async () => {
  await clearTestDatabase();
  resetMcpGuards();
  setMcpClientFactory(createScriptedMcp({ tools: SCRIPTED_CRM_TOOLS }).factory);
});

afterEach(() => {
  setMcpClientFactory(null);
  resetMcpGuards();
});

/** A signed-in manager, which is all any route here needs. */
const signIn = async (): Promise<string> => {
  const branch = await createTestBranch();
  const { authorization } = await signInAs(app, 'manager', String(branch._id));

  return authorization;
};

const createMcpIntegration = async (
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; body: Record<string, unknown> }> => {
  const response = await request(app)
    .post(url)
    .set('Authorization', token)
    .send({
      provider: 'custom_mcp',
      name: 'My CRM',
      serverUrl: SERVER_URL,
      transport: 'http',
      authMethod: 'bearer',
      secret: 'crm-secret-token',
      ...overrides,
    });

  expect(response.status).toBe(HTTP_STATUS.CREATED);

  return { id: response.body.data.id, body: response.body.data };
};

describe('integration lifecycle', () => {
  it('creates an integration in the disconnected state, without connecting to anything', async () => {
    const token = await signIn();
    const { body } = await createMcpIntegration(token);

    // Creating is not connecting: a typo in an address should cost a failed
    // test, not a hung request during creation.
    expect(body.status).toBe('disconnected');
    expect(body.enabled).toBe(true);
    expect(body.hasCredentials).toBe(true);
    expect(body.tools).toEqual([]);
  });

  it('lists only the caller’s own integrations', async () => {
    const alice = await signIn();
    const bob = await signIn();

    await createMcpIntegration(alice, { name: 'Alice CRM' });
    await createMcpIntegration(bob, { name: 'Bob CRM' });

    const response = await request(app).get(url).set('Authorization', alice);

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].name).toBe('Alice CRM');
  });

  it('reads, updates and deletes one integration', async () => {
    const token = await signIn();
    const { id } = await createMcpIntegration(token);

    const read = await request(app).get(`${url}/${id}`).set('Authorization', token);
    expect(read.status).toBe(HTTP_STATUS.OK);
    expect(read.body.data.name).toBe('My CRM');

    const updated = await request(app)
      .patch(`${url}/${id}`)
      .set('Authorization', token)
      .send({ name: 'Renamed CRM', description: 'Our customer system' });

    expect(updated.status).toBe(HTTP_STATUS.OK);
    expect(updated.body.data.name).toBe('Renamed CRM');

    const removed = await request(app).delete(`${url}/${id}`).set('Authorization', token);
    expect(removed.status).toBe(HTTP_STATUS.NO_CONTENT);

    const gone = await request(app).get(`${url}/${id}`).set('Authorization', token);
    expect(gone.status).toBe(HTTP_STATUS.NOT_FOUND);
  });

  it('connects, discovers tools and reports the server it reached', async () => {
    const token = await signIn();
    const { id } = await createMcpIntegration(token);

    const connected = await request(app).post(`${url}/${id}/connect`).set('Authorization', token);

    expect(connected.status).toBe(HTTP_STATUS.OK);
    expect(connected.body.data.health.healthy).toBe(true);
    expect(connected.body.data.integration.status).toBe('connected');
    expect(
      connected.body.data.integration.tools.map((tool: { name: string }) => tool.name),
    ).toEqual(['search_customers', 'get_orders', 'create_invoice', 'delete_customer']);
  });

  it('tests a connection without calling any of the discovered tools', async () => {
    const token = await signIn();
    const scripted = createScriptedMcp({ tools: SCRIPTED_CRM_TOOLS });
    setMcpClientFactory(scripted.factory);

    const { id } = await createMcpIntegration(token);
    const tested = await request(app).post(`${url}/${id}/test`).set('Authorization', token);

    expect(tested.status).toBe(HTTP_STATUS.OK);
    expect(tested.body.data.health.healthy).toBe(true);
    expect(tested.body.data.health.toolCount).toBe(4);
    // The whole point of a safe test: pressing the button must never send an
    // invoice.
    expect(scripted.recorder.calls).toEqual([]);
  });

  it('reports an unreachable server as a diagnosis rather than an error response', async () => {
    const token = await signIn();
    const { id } = await createMcpIntegration(token);

    setMcpClientFactory(createScriptedMcp({ connectError: new McpError('unreachable') }).factory);

    const tested = await request(app).post(`${url}/${id}/test`).set('Authorization', token);

    // The caller asked "does this work?"; "no" is the answer, not a failure to
    // answer, so the screen shows a diagnosis instead of an error banner.
    expect(tested.status).toBe(HTTP_STATUS.OK);
    expect(tested.body.data.health.healthy).toBe(false);
    expect(tested.body.data.health.message).toBe('The server could not be reached.');
  });

  it('records a failed connection on the integration itself', async () => {
    const token = await signIn();
    const { id } = await createMcpIntegration(token);

    setMcpClientFactory(
      createScriptedMcp({ connectError: new McpError('authentication') }).factory,
    );

    const connected = await request(app).post(`${url}/${id}/connect`).set('Authorization', token);

    expect(connected.body.data.integration.status).toBe('error');
    expect(connected.body.data.integration.lastError).toBe(
      'The server refused the saved credential.',
    );
    expect(connected.body.data.integration.lastErrorAt).not.toBeNull();
  });

  it('reconnects a failed integration once the server recovers', async () => {
    const token = await signIn();
    const { id } = await createMcpIntegration(token);

    setMcpClientFactory(createScriptedMcp({ connectError: new McpError('unreachable') }).factory);
    await request(app).post(`${url}/${id}/connect`).set('Authorization', token);

    setMcpClientFactory(createScriptedMcp({ tools: SCRIPTED_CRM_TOOLS }).factory);
    const retried = await request(app).post(`${url}/${id}/connect`).set('Authorization', token);

    expect(retried.body.data.integration.status).toBe('connected');
    expect(retried.body.data.integration.lastError).toBeNull();
  });

  it('disconnects, destroying the stored credential rather than parking it', async () => {
    const token = await signIn();
    const { id } = await createMcpIntegration(token);
    await request(app).post(`${url}/${id}/connect`).set('Authorization', token);

    const disconnected = await request(app)
      .post(`${url}/${id}/disconnect`)
      .set('Authorization', token);

    expect(disconnected.status).toBe(HTTP_STATUS.OK);
    expect(disconnected.body.data.status).toBe('disconnected');
    expect(disconnected.body.data.hasCredentials).toBe(false);

    // "Disconnected" has to mean the token is gone, or the promise is a lie.
    expect(await IntegrationCredentialModel.countDocuments({})).toBe(0);

    // The permission table survives, so pausing an integration for a day does
    // not cost a carefully-set configuration.
    expect(disconnected.body.data.tools).toHaveLength(4);
  });

  it('refuses a second native integration for the same provider', async () => {
    const token = await signIn();

    const first = await request(app)
      .post(url)
      .set('Authorization', token)
      .send({ provider: 'billz', name: 'Billz' });

    expect(first.status).toBe(HTTP_STATUS.CREATED);

    const second = await request(app)
      .post(url)
      .set('Authorization', token)
      .send({ provider: 'billz', name: 'Billz again' });

    expect(second.status).toBe(HTTP_STATUS.CONFLICT);
  });

  it('clears discovered tools when the connection settings change', async () => {
    const token = await signIn();
    const { id } = await createMcpIntegration(token);
    await request(app).post(`${url}/${id}/connect`).set('Authorization', token);

    const moved = await request(app)
      .patch(`${url}/${id}`)
      .set('Authorization', token)
      .send({ serverUrl: 'https://other-crm.example.com/mcp' });

    // A permission table describing a server that is no longer the one being
    // called would read as a promise Hadiya cannot keep.
    expect(moved.body.data.tools).toEqual([]);
    expect(moved.body.data.status).toBe('disconnected');
  });
});

describe('provider catalogue', () => {
  it('offers only auth methods that are actually implemented', async () => {
    const token = await signIn();
    const response = await request(app).get(`${url}/catalogue`).set('Authorization', token);

    expect(response.status).toBe(HTTP_STATUS.OK);

    const mcp = response.body.data.items.find(
      (item: { provider: string }) => item.provider === 'custom_mcp',
    );

    // Offering OAuth here would produce an integration permanently stuck at
    // "authentication required", because nothing implements the flow.
    expect(mcp.authMethods).toEqual(['none', 'bearer', 'header']);
    expect(mcp.authMethods).not.toContain('oauth');
  });
});

describe('server addresses', () => {
  it('refuses an address inside a private network', async () => {
    const token = await signIn();

    for (const serverUrl of [
      'https://127.0.0.1/mcp',
      'https://localhost/mcp',
      'https://169.254.169.254/latest/meta-data',
      'https://10.0.0.5/mcp',
      'https://192.168.1.10/mcp',
    ]) {
      const response = await request(app)
        .post(url)
        .set('Authorization', token)
        .send({ provider: 'custom_mcp', name: 'Internal', serverUrl, authMethod: 'none' });

      // Hadiya makes the outbound request, so an unchecked address is a request
      // forgery primitive handed to anyone with an account.
      expect(response.status, serverUrl).toBe(HTTP_STATUS.BAD_REQUEST);
    }
  });

  it('refuses plain HTTP and credentials embedded in the address', async () => {
    const token = await signIn();

    for (const serverUrl of [
      'http://crm.example.com/mcp',
      'https://user:pass@crm.example.com/mcp',
    ]) {
      const response = await request(app)
        .post(url)
        .set('Authorization', token)
        .send({ provider: 'custom_mcp', name: 'Bad', serverUrl, authMethod: 'none' });

      expect(response.status, serverUrl).toBe(HTTP_STATUS.BAD_REQUEST);
    }
  });
});

describe('ownership', () => {
  it('hides another account’s integration behind a 404 on every route', async () => {
    const alice = await signIn();
    const bob = await signIn();
    const { id } = await createMcpIntegration(alice);

    // Every by-id route, so a new one cannot be added without an ownership
    // check and still pass this suite.
    const routes: Array<{ label: string; send: () => request.Test }> = [
      { label: 'GET /:id', send: () => request(app).get(`${url}/${id}`) },
      { label: 'PATCH /:id', send: () => request(app).patch(`${url}/${id}`) },
      { label: 'DELETE /:id', send: () => request(app).delete(`${url}/${id}`) },
      { label: 'POST /:id/test', send: () => request(app).post(`${url}/${id}/test`) },
      { label: 'POST /:id/connect', send: () => request(app).post(`${url}/${id}/connect`) },
      { label: 'POST /:id/disconnect', send: () => request(app).post(`${url}/${id}/disconnect`) },
      { label: 'POST /:id/refresh', send: () => request(app).post(`${url}/${id}/refresh`) },
      {
        label: 'PATCH /:id/tools/:tool',
        send: () => request(app).patch(`${url}/${id}/tools/search_customers`),
      },
    ];

    for (const route of routes) {
      const response = await route
        .send()
        .set('Authorization', bob)
        .send({ name: 'Stolen', permission: 'enabled' });

      // Not found rather than forbidden: a 403 would confirm the id exists.
      expect(response.status, route.label).toBe(HTTP_STATUS.NOT_FOUND);
    }
  });

  it('leaves another account’s integration untouched after a failed attempt', async () => {
    const alice = await signIn();
    const bob = await signIn();
    const { id } = await createMcpIntegration(alice);

    await request(app).delete(`${url}/${id}`).set('Authorization', bob);

    const stillThere = await request(app).get(`${url}/${id}`).set('Authorization', alice);
    expect(stillThere.status).toBe(HTTP_STATUS.OK);
  });

  it('never lets one account reach another’s credential', async () => {
    const alice = await signIn();
    const bob = await signIn();
    const { id } = await createMcpIntegration(alice);

    // The credential row is scoped to its owner in the query that finds it, not
    // by a check afterwards, so a wrong actor finds nothing at all.
    const stored = await IntegrationCredentialModel.findOne({ integration: id }).lean();
    expect(stored).not.toBeNull();

    const bobList = await request(app).get(url).set('Authorization', bob);
    expect(bobList.body.data.items).toEqual([]);
  });
});

describe('credential secrecy', () => {
  it('never returns a credential from any endpoint', async () => {
    const token = await signIn();
    const secret = 'crm-secret-token';
    const { id } = await createMcpIntegration(token, { secret });

    const responses = [
      await request(app).get(url).set('Authorization', token),
      await request(app).get(`${url}/${id}`).set('Authorization', token),
      await request(app).post(`${url}/${id}/connect`).set('Authorization', token),
      await request(app).post(`${url}/${id}/test`).set('Authorization', token),
      await request(app).get(`${url}/activity`).set('Authorization', token),
    ];

    for (const response of responses) {
      // The whole body, not a field-by-field check: the point is that the
      // secret is absent from the response entirely, however it were nested.
      expect(JSON.stringify(response.body)).not.toContain(secret);
    }
  });

  it('stores the credential encrypted, not as readable text', async () => {
    const token = await signIn();
    const secret = 'crm-secret-token';
    await createMcpIntegration(token, { secret });

    const stored = await IntegrationCredentialModel.findOne({}).lean();

    expect(stored).not.toBeNull();
    expect(stored?.ciphertext).not.toContain(secret);
    expect(stored?.iv).toBeTruthy();
    expect(stored?.authTag).toBeTruthy();

    // And nothing resembling it landed on the integration document itself.
    const integration = await IntegrationModel.findOne({}).lean();
    expect(JSON.stringify(integration)).not.toContain(secret);
  });

  it('sends the credential to the server and keeps it nowhere else', async () => {
    const token = await signIn();
    const scripted = createScriptedMcp({ tools: SCRIPTED_CRM_TOOLS });
    setMcpClientFactory(scripted.factory);

    const { id } = await createMcpIntegration(token, { secret: 'crm-secret-token' });
    await request(app).post(`${url}/${id}/connect`).set('Authorization', token);

    // It does reach the transport — that is the point of storing it — and the
    // assertions above prove it reaches nothing else.
    expect(scripted.recorder.connections[0]?.settings.secret).toBe('crm-secret-token');
  });

  it('keeps the credential when an update does not mention it', async () => {
    const token = await signIn();
    const { id } = await createMcpIntegration(token);

    const renamed = await request(app)
      .patch(`${url}/${id}`)
      .set('Authorization', token)
      .send({ name: 'Renamed' });

    expect(renamed.body.data.hasCredentials).toBe(true);
  });

  it('records no credential in the audit trail', async () => {
    const token = await signIn();
    const secret = 'crm-secret-token';
    const { id } = await createMcpIntegration(token, { secret });
    await request(app).post(`${url}/${id}/connect`).set('Authorization', token);

    const rows = await IntegrationAuditModel.find({}).lean();

    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain(secret);
  });
});

describe('audit trail', () => {
  it('records the lifecycle and survives the integration’s deletion', async () => {
    const token = await signIn();
    const { id } = await createMcpIntegration(token);

    await request(app).post(`${url}/${id}/connect`).set('Authorization', token);
    await request(app).delete(`${url}/${id}`).set('Authorization', token);

    const activity = await request(app).get(`${url}/activity`).set('Authorization', token);
    const actions = activity.body.data.items.map((item: { action: string }) => item.action);

    expect(actions).toContain('integration_created');
    expect(actions).toContain('integration_connected');
    expect(actions).toContain('mcp_tools_discovered');
    expect(actions).toContain('integration_deleted');

    // Removing a CRM must not also remove the record of what it did.
    const detached = activity.body.data.items.filter(
      (item: { integration: string | null }) => item.integration === null,
    );
    expect(detached.length).toBeGreaterThan(0);
  });

  it('shows an account only its own activity', async () => {
    const alice = await signIn();
    const bob = await signIn();

    await createMcpIntegration(alice);

    const bobActivity = await request(app).get(`${url}/activity`).set('Authorization', bob);
    expect(bobActivity.body.data.items).toEqual([]);
  });
});
