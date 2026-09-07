import { mcpToolRegistryName, type AuthenticatedUser } from '@hadiya/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../../test/database.js';
import { actorFor, createTestBranch, createTestUser } from '../../test/factories.js';
import { sendMessage } from '../ai/agent/agent.service.js';
import { createScriptedProvider } from '../ai/test-support.js';
import { buildActorToolRegistry } from '../ai/tools/index.js';
import { connectIntegration } from './integration.connect.service.js';
import { IntegrationModel, type IntegrationDocument } from './integration.model.js';
import { createIntegration, setToolPermission } from './integration.service.js';
import { setMcpClientFactory } from './mcp/mcp-client.js';
import { resetMcpGuards } from './mcp/mcp-guard.js';
import { createScriptedMcp, SCRIPTED_CRM_TOOLS } from './mcp/mcp-test-double.js';

/**
 * The assistant using a connected MCP server, end to end.
 *
 * Both ends are scripted — a fixed model and a fixed server — because what is
 * under test is everything in between: whether the tools reach the model at
 * all, whether a confirmation stops a call, and whether a result comes back in
 * a shape the agent can answer from. Neither a real model nor a real server
 * would make any of that more true, and both would make it flaky.
 *
 * The user speaks Uzbek in these tests because that is who Hadiya is for, and
 * because "CRMdagi Azamjonni top" is the sentence the feature was described by.
 */

// Constructed for its side effects: building the app registers this module's
// routes and models. The tests below drive the services directly.
createApp();

beforeAll(startTestDatabase);
afterAll(stopTestDatabase);

beforeEach(async () => {
  await clearTestDatabase();
  resetMcpGuards();
});

afterEach(() => {
  setMcpClientFactory(null);
  resetMcpGuards();
});

const anActor = async (): Promise<AuthenticatedUser> => {
  const branch = await createTestBranch();
  const user = await createTestUser('manager', String(branch._id));

  return actorFor(user);
};

const aConnectedCrm = async (actor: AuthenticatedUser): Promise<IntegrationDocument> => {
  const created = await createIntegration(actor, {
    provider: 'custom_mcp',
    name: 'My CRM',
    serverUrl: 'https://crm.example.com/mcp',
    transport: 'http',
    authMethod: 'bearer',
    secret: 'crm-secret-token',
  });

  const { integration } = await connectIntegration(actor, String(created._id));

  return integration;
};

describe('the assistant with a connected MCP server', () => {
  it('is offered the connected server’s tools alongside its own', async () => {
    const actor = await anActor();
    setMcpClientFactory(createScriptedMcp({ tools: SCRIPTED_CRM_TOOLS }).factory);

    const integration = await aConnectedCrm(actor);
    const registry = await buildActorToolRegistry(actor);
    const names = registry.list().map((tool) => tool.name);

    // The built-ins are untouched, which is the compatibility promise: adding
    // an integration must not cost the assistant its memory or its reminders.
    expect(names).toContain('remember_information');
    expect(names).toContain('billz_get_sales_summary');
    expect(names).toContain(mcpToolRegistryName(String(integration._id), 'search_customers'));
  });

  it('answers "CRMdagi Azamjonni top" from the MCP tool’s result', async () => {
    const actor = await anActor();
    const scripted = createScriptedMcp({
      tools: SCRIPTED_CRM_TOOLS,
      results: { search_customers: 'Azamjon Karimov — +998 90 123 45 67, 3 ta buyurtma' },
    });
    setMcpClientFactory(scripted.factory);

    const integration = await aConnectedCrm(actor);
    const toolName = mcpToolRegistryName(String(integration._id), 'search_customers');

    const provider = createScriptedProvider([
      {
        content: '',
        toolCalls: [{ callId: 'call-1', name: toolName, arguments: { query: 'Azamjon' } }],
      },
      { content: 'Azamjon Karimov topildi: +998 90 123 45 67, 3 ta buyurtma bor.' },
    ]);

    const result = await sendMessage(
      actor,
      { message: 'CRMdagi Azamjonni top.' },
      { provider, registry: await buildActorToolRegistry(actor) },
    );

    expect(scripted.recorder.calls).toEqual([
      { name: 'search_customers', args: { query: 'Azamjon' } },
    ]);
    expect(result.message.content).toContain('Azamjon Karimov');

    // The result reached the model as labelled external data on its own turn.
    const secondRequest = provider.requests[1];
    expect(JSON.stringify(secondRequest?.messages)).toContain('BEGIN EXTERNAL DATA');
  });

  it('asks before creating an invoice, and does not call the tool', async () => {
    const actor = await anActor();
    const scripted = createScriptedMcp({
      tools: SCRIPTED_CRM_TOOLS,
      results: { create_invoice: 'Invoice INV-1042 created.' },
    });
    setMcpClientFactory(scripted.factory);

    const integration = await aConnectedCrm(actor);
    const toolName = mcpToolRegistryName(String(integration._id), 'create_invoice');

    const provider = createScriptedProvider([
      {
        content: '',
        toolCalls: [
          {
            callId: 'call-1',
            name: toolName,
            // No `confirm`, which is the whole point.
            arguments: { customerId: 'c-1', amount: 250_000 },
          },
        ],
      },
      { content: 'CRMda invoice yaratishimga ruxsat berasizmi?' },
    ]);

    const result = await sendMessage(
      actor,
      { message: 'CRMdagi Azamjonga invoice yarat.' },
      { provider, registry: await buildActorToolRegistry(actor) },
    );

    // Nothing reached the server. The confirmation is enforced by the registry
    // — the same mechanism every other destructive tool in Hadiya uses — so
    // there is no second confirmation system to keep in step with this one.
    expect(scripted.recorder.calls).toEqual([]);
    expect(result.message.content).toContain('ruxsat');
  });

  it('runs the invoice tool once the person has agreed', async () => {
    const actor = await anActor();
    const scripted = createScriptedMcp({
      tools: SCRIPTED_CRM_TOOLS,
      results: { create_invoice: 'Invoice INV-1042 created.' },
    });
    setMcpClientFactory(scripted.factory);

    const integration = await aConnectedCrm(actor);
    const toolName = mcpToolRegistryName(String(integration._id), 'create_invoice');

    // The turn that asks. It is what writes down the proposal the agreement is
    // later checked against, so a run that skipped it has nothing to agree to.
    const asking = createScriptedProvider([
      {
        content: '',
        toolCalls: [
          {
            callId: 'call-1',
            name: toolName,
            arguments: { customerId: 'c-1', amount: 250_000 },
          },
        ],
      },
      { content: 'Ruxsat berasizmi?' },
    ]);

    const proposed = await sendMessage(
      actor,
      { message: 'CRMdagi Azamjonga invoice yarat.' },
      { provider: asking, registry: await buildActorToolRegistry(actor) },
    );

    expect(scripted.recorder.calls).toEqual([]);
    expect(proposed.agent?.state).toBe('waiting_for_confirmation');

    const provider = createScriptedProvider([
      {
        content: '',
        toolCalls: [
          {
            callId: 'call-2',
            name: toolName,
            arguments: { customerId: 'c-1', amount: 250_000, confirm: true },
          },
        ],
      },
      { content: 'Invoice yaratildi: INV-1042.' },
    ]);

    const result = await sendMessage(
      actor,
      { conversationId: proposed.conversationId, message: 'Ha, yarat.' },
      { provider, registry: await buildActorToolRegistry(actor) },
    );

    expect(scripted.recorder.calls).toHaveLength(1);
    // `confirm` is Hadiya's own field and must not be forwarded as an argument
    // the server never declared.
    expect(scripted.recorder.calls[0]?.args).toEqual({ customerId: 'c-1', amount: 250_000 });
    expect(result.message.content).toContain('INV-1042');
  });

  it('never offers a disconnected integration’s tools to the model', async () => {
    const actor = await anActor();
    setMcpClientFactory(createScriptedMcp({ tools: SCRIPTED_CRM_TOOLS }).factory);

    const integration = await aConnectedCrm(actor);
    await IntegrationModel.updateOne(
      { _id: integration._id },
      { $set: { status: 'disconnected' } },
    );

    const provider = createScriptedProvider([{ content: 'CRM ulanmagan.' }]);

    await sendMessage(
      actor,
      { message: 'CRMdagi Azamjonni top.' },
      { provider, registry: await buildActorToolRegistry(actor) },
    );

    const offered = provider.requests[0]?.toolNames ?? [];
    expect(offered.some((name) => name.startsWith('mcp.'))).toBe(false);
  });

  it('never offers a blocked tool to the model', async () => {
    const actor = await anActor();
    setMcpClientFactory(createScriptedMcp({ tools: SCRIPTED_CRM_TOOLS }).factory);

    const integration = await aConnectedCrm(actor);
    const id = String(integration._id);
    await setToolPermission(actor, id, 'delete_customer', 'blocked');

    const provider = createScriptedProvider([{ content: 'Bajarib boʻlmaydi.' }]);

    await sendMessage(
      actor,
      { message: 'CRMdan Azamjonni oʻchir.' },
      { provider, registry: await buildActorToolRegistry(actor) },
    );

    const offered = provider.requests[0]?.toolNames ?? [];
    expect(offered).not.toContain(mcpToolRegistryName(id, 'delete_customer'));
    expect(offered).toContain(mcpToolRegistryName(id, 'search_customers'));
  });

  it('gives one account nothing from another account’s server', async () => {
    const alice = await anActor();
    const bob = await anActor();
    setMcpClientFactory(createScriptedMcp({ tools: SCRIPTED_CRM_TOOLS }).factory);

    await aConnectedCrm(alice);

    const provider = createScriptedProvider([{ content: 'Nimadir.' }]);

    await sendMessage(
      bob,
      { message: 'CRMdagi Azamjonni top.' },
      { provider, registry: await buildActorToolRegistry(bob) },
    );

    // The registry is built per turn from the actor's own integrations, so
    // Bob's turn cannot contain Alice's CRM.
    const offered = provider.requests[0]?.toolNames ?? [];
    expect(offered.some((name) => name.startsWith('mcp.'))).toBe(false);
  });

  it('carries on with its own tools when an integration cannot be reached', async () => {
    const actor = await anActor();
    setMcpClientFactory(createScriptedMcp({ tools: SCRIPTED_CRM_TOOLS }).factory);

    const integration = await aConnectedCrm(actor);
    const toolName = mcpToolRegistryName(String(integration._id), 'search_customers');

    // The server goes away between the registry being built and the call.
    const failing = createScriptedMcp({
      tools: SCRIPTED_CRM_TOOLS,
      connectError: new (await import('./mcp/mcp-error.js')).McpError('unreachable'),
    });
    const registry = await buildActorToolRegistry(actor);
    setMcpClientFactory(failing.factory);

    const provider = createScriptedProvider([
      {
        content: '',
        toolCalls: [{ callId: 'call-1', name: toolName, arguments: { query: 'Azamjon' } }],
      },
      { content: 'CRM bilan bogʻlanib boʻlmadi.' },
    ]);

    const result = await sendMessage(
      actor,
      { message: 'CRMdagi Azamjonni top.' },
      { provider, registry },
    );

    // A failed tool is a failed step the model can talk about, not a failed
    // turn — and the person is told in words rather than shown a stack trace.
    expect(result.message.content).toContain('bogʻlanib');
    expect(JSON.stringify(provider.requests[1]?.messages)).toContain('could not be reached');
  });
});
