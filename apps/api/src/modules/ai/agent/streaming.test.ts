import {
  mcpToolRegistryName,
  toStreamEvent,
  type AgentEvent,
  type AgentStreamFrame,
  type AuthenticatedUser,
} from '@hadiya/shared';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../../app.js';
import { ApiError } from '../../../core/http/api-error.js';
import { HTTP_STATUS } from '../../../core/http/http-status.js';
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../../../test/database.js';
import { actorFor, createTestBranch, createTestUser, signInAs } from '../../../test/factories.js';
import * as conversationService from '../../conversations/conversation.service.js';
import { connectIntegration } from '../../integrations/integration.connect.service.js';
import { createIntegration } from '../../integrations/integration.service.js';
import { setMcpClientFactory } from '../../integrations/mcp/mcp-client.js';
import { resetMcpGuards } from '../../integrations/mcp/mcp-guard.js';
import { createScriptedMcp, SCRIPTED_CRM_TOOLS } from '../../integrations/mcp/mcp-test-double.js';
import { setAiProvider } from '../provider/index.js';
import { buildActorToolRegistry } from '../tools/index.js';
import {
  createProbeRegistry,
  createScriptedProvider,
  createToolProbe,
  FAST_AGENT_LIMITS,
  parseSse,
  toolCall,
  type SseFrame,
} from '../test-support.js';
import { sendMessage } from './agent.service.js';
import { cancelConversationRuns, resetAgentRuns } from './agent-cancellation.js';
// Never `clearAgentEventListeners` here: the registry installs its own listener
// at import time, and dropping it would leave every later test watching a run
// nothing records. Each tap below removes only itself, in a `finally`.
import { onAgentEvent, publishAgentEvent } from './agent-events.js';
import * as runRegistry from './agent-run-registry.js';

/**
 * Watching a turn happen.
 *
 * The transport is tested where it can be tested honestly. A finished run
 * produces a complete SSE body, which `supertest` can read and this file can
 * parse frame by frame — that covers the wire format, the ordering, the ids and
 * everything a browser would key off. A run that is still going never ends its
 * response, which no buffering HTTP client can assert against, so those
 * properties (fan-out, replay, cleanup, concurrent watchers) are driven through
 * the registry that the handler itself uses.
 *
 * Nothing here calls a model or opens a socket to anybody.
 */

const app = createApp();

beforeAll(startTestDatabase);
afterAll(stopTestDatabase);

beforeEach(async () => {
  await clearTestDatabase();
  runRegistry.resetRunRegistry();
  resetAgentRuns();
  resetMcpGuards();
});

afterEach(() => {
  setAiProvider(null);
  setMcpClientFactory(null);
  runRegistry.resetRunRegistry();
  resetAgentRuns();
  resetMcpGuards();
});

const limits = { ...FAST_AGENT_LIMITS };

const anActor = async (): Promise<AuthenticatedUser> => {
  const branch = await createTestBranch();
  const user = await createTestUser('manager', String(branch._id));

  return actorFor(user);
};

const aSession = async () => {
  const branch = await createTestBranch();

  return signInAs(app, 'manager', String(branch._id));
};

/** The events of a parsed body, in order, as their wire type. */
const eventTypes = (frames: SseFrame[]): string[] =>
  frames
    .map((frame) => frame.data as AgentStreamFrame)
    .filter((frame) => frame.frame === 'event')
    .map((frame) => frame.event.type);

const eventsOf = (frames: SseFrame[]): AgentEvent[] =>
  frames
    .map((frame) => frame.data as AgentStreamFrame)
    .filter(
      (frame): frame is Extract<AgentStreamFrame, { frame: 'event' }> => frame.frame === 'event',
    )
    .map((frame) => frame.event);

/**
 * Collects every event a run emits, through the real fan-out.
 *
 * A test that drives `sendMessage` directly does not know the run id that was
 * generated inside it, and does not need to: this listens the way the registry
 * itself listens, and hands back a stop function so nothing leaks into the
 * next test.
 */
const tapEvents = (into: AgentEvent[]): (() => void) =>
  onAgentEvent((event) => {
    into.push(event);
  });

const frameOf = <TKind extends AgentStreamFrame['frame']>(
  frames: SseFrame[],
  kind: TKind,
): Extract<AgentStreamFrame, { frame: TKind }> | undefined =>
  frames
    .map((frame) => frame.data as AgentStreamFrame)
    .find((frame): frame is Extract<AgentStreamFrame, { frame: TKind }> => frame.frame === kind);

/* -------------------------------------------------------------------------- */
/* The transport                                                              */
/* -------------------------------------------------------------------------- */

describe('POST /api/v1/ai/chat as a stream', () => {
  it('is refused without a token', async () => {
    const response = await request(app).post('/api/v1/ai/chat?stream=1').send({ message: 'Salom' });

    expect(response.status).toBe(HTTP_STATUS.UNAUTHORIZED);
    // Refused before a stream is opened, so the caller gets a status code it
    // can act on rather than an error buried inside a body it must parse.
    expect(response.headers['content-type']).not.toContain('text/event-stream');
  });

  it('answers the same turn as JSON when streaming is not asked for', async () => {
    const session = await aSession();
    setAiProvider(createScriptedProvider([{ content: 'Salom!' }]));

    const response = await request(app)
      .post('/api/v1/ai/chat')
      .set('Authorization', session.authorization)
      .send({ message: 'Salom' });

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.body.data.message.content).toBe('Salom!');
  });

  it('streams the run and closes with the same turn a JSON caller would get', async () => {
    const session = await aSession();
    setAiProvider(createScriptedProvider([{ content: 'Salom!' }]));

    const response = await request(app)
      .post('/api/v1/ai/chat?stream=1')
      .set('Authorization', session.authorization)
      .send({ message: 'Salom' });

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.headers['content-type']).toContain('text/event-stream');
    // Without this the compression middleware would hold the whole stream.
    expect(response.headers['cache-control']).toContain('no-transform');

    const frames = parseSse(response.text);
    const ready = frameOf(frames, 'ready');
    const result = frameOf(frames, 'result');

    expect(ready?.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(eventTypes(frames)).toContain('agent.started');
    expect(eventTypes(frames)).toContain('agent.completed');
    expect(result?.response.message.content).toBe('Salom!');
    // The run summary rides along, so a streaming client holds the same object.
    expect(result?.response.agent?.state).toBe('completed');
  });

  it('accepts the Accept header as the request to stream', async () => {
    const session = await aSession();
    setAiProvider(createScriptedProvider([{ content: 'Salom!' }]));

    const response = await request(app)
      .post('/api/v1/ai/chat')
      .set('Authorization', session.authorization)
      .set('Accept', 'text/event-stream')
      .send({ message: 'Salom' });

    expect(response.headers['content-type']).toContain('text/event-stream');
  });

  it('numbers every event so a client can resume and de-duplicate', async () => {
    const session = await aSession();
    setAiProvider(createScriptedProvider([{ content: 'Tayyor.' }]));

    const response = await request(app)
      .post('/api/v1/ai/chat?stream=1')
      .set('Authorization', session.authorization)
      .send({ message: 'Savol' });

    const frames = parseSse(response.text);
    const ids = frames.filter((frame) => frame.id !== null).map((frame) => Number(frame.id));

    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toEqual([...ids].sort((left, right) => left - right));
    expect(new Set(ids).size).toBe(ids.length);
    // The SSE event name is the agent event's own type, so a client can listen
    // for one kind rather than switching inside a single handler.
    expect(frames.some((frame) => frame.event === 'agent.started')).toBe(true);
  });

  it('reports a failed turn inside the stream rather than as a status code', async () => {
    const session = await aSession();
    setAiProvider({
      name: 'broken',
      isConfigured: true,
      complete: () => Promise.reject(ApiError.dependencyUnavailable('The model is unavailable.')),
    });

    const response = await request(app)
      .post('/api/v1/ai/chat?stream=1')
      .set('Authorization', session.authorization)
      .send({ message: 'Savol' });

    // The response had already begun, so there is no status left to set.
    expect(response.status).toBe(HTTP_STATUS.OK);

    const frames = parseSse(response.text);
    const failure = frameOf(frames, 'error');

    expect(eventTypes(frames)).toContain('agent.failed');
    // The `ApiError`'s own message, which is written for a person; nothing of
    // the underlying failure crosses the wire.
    expect(failure?.message).toBe('The model is unavailable.');
    expect(failure?.code).toBe('DEPENDENCY_UNAVAILABLE');
  });

  it('refuses to continue another employee’s conversation', async () => {
    const owner = await anActor();
    const stranger = await aSession();
    const conversation = await conversationService.createConversation(owner, { title: 'Mine' });

    setAiProvider(createScriptedProvider([{ content: 'Salom!' }]));

    const response = await request(app)
      .post('/api/v1/ai/chat?stream=1')
      .set('Authorization', stranger.authorization)
      .send({ conversationId: String(conversation._id), message: 'Salom' });

    const failure = frameOf(parseSse(response.text), 'error');

    expect(failure?.code).toBe('NOT_FOUND');
  });
});

/* -------------------------------------------------------------------------- */
/* What the events say                                                        */
/* -------------------------------------------------------------------------- */

describe('the events a run emits', () => {
  it('says a tool started and then finished, naming the call both times', async () => {
    const actor = await anActor();
    const probe = createToolProbe({ name: 'read_sales', summary: 'Bugun 12 ta.' });
    const seen: AgentEvent[] = [];
    const stop = tapEvents(seen);

    try {
      await sendMessage(
        actor,
        { message: 'Savdo?' },
        {
          provider: createScriptedProvider([
            { content: '', toolCalls: [toolCall('read_sales')] },
            { content: 'Bugun 12 ta sotuv.' },
          ]),
          registry: createProbeRegistry([probe.tool]),
          limits,
        },
      );
    } finally {
      stop();
    }

    const started = seen.find((event) => event.type === 'tool.started');
    const completed = seen.find((event) => event.type === 'tool.completed');

    // The same call id on both, which is the only thing that lets a browser
    // turn a spinner into a tick rather than drawing a second row.
    expect(toStreamEvent(started as AgentEvent)).toMatchObject({
      type: 'tool.started',
      toolCallId: 'call-read_sales',
    });
    expect(toStreamEvent(completed as AgentEvent)).toMatchObject({
      type: 'tool.completed',
      toolCallId: 'call-read_sales',
    });
    expect(probe.calls).toHaveLength(1);
  });

  it('carries a safe label for every tool, and never an argument', async () => {
    const actor = await anActor();
    const probe = createToolProbe({ name: 'billz_get_sales_summary', summary: 'Bugun 12 ta.' });
    const seen: AgentEvent[] = [];
    const stop = tapEvents(seen);

    try {
      await sendMessage(
        actor,
        { message: 'Savdo?' },
        {
          provider: createScriptedProvider([
            {
              content: '',
              toolCalls: [
                toolCall('billz_get_sales_summary', { apiKey: 'sk-never', from: '2026-01-01' }),
              ],
            },
            { content: 'Tayyor.' },
          ]),
          registry: createProbeRegistry([probe.tool]),
          limits,
        },
      );
    } finally {
      stop();
    }

    const started = seen.find((event) => event.type === 'tool.started');
    const typed = started ? toStreamEvent(started) : null;

    expect(typed).toMatchObject({
      type: 'tool.started',
      toolName: 'billz_get_sales_summary',
      displayName: 'Sales figures',
      runningLabel: 'Reading the sales figures',
    });

    // Arguments never travel, so a credential somebody pasted into the chat
    // cannot reach a stream aimed at a browser.
    const serialised = JSON.stringify(seen);

    expect(serialised).not.toContain('sk-never');
    expect(serialised).not.toContain('2026-01-01');
  });

  it('says which step failed, in words a person can read', async () => {
    const actor = await anActor();
    const probe = createToolProbe({
      name: 'notion_save',
      mutates: true,
      failTimes: 99,
      error: () => ApiError.dependencyUnavailable('Notion is unreachable'),
    });
    const seen: AgentEvent[] = [];
    const stop = tapEvents(seen);

    try {
      await sendMessage(
        actor,
        { message: 'Notionga saqla.' },
        {
          provider: createScriptedProvider([
            { content: '', toolCalls: [toolCall('notion_save')] },
            { content: 'Saqlashda xatolik.' },
          ]),
          registry: createProbeRegistry([probe.tool]),
          limits,
        },
      );
    } finally {
      stop();
    }

    const failed = seen.find((event) => event.type === 'tool.failed');
    const typed = failed ? toStreamEvent(failed) : null;

    expect(typed).toMatchObject({ type: 'tool.failed', toolName: 'notion_save' });
    expect((typed as { message: string }).message).toContain('Notion is unreachable');
  });

  it('shows parallel reads as overlapping rather than as a queue', async () => {
    const actor = await anActor();
    const probes = ['read_sales', 'read_expenses', 'read_debts'].map((name) =>
      createToolProbe({ name, delayMs: 60 }),
    );
    const seen: AgentEvent[] = [];
    const stop = tapEvents(seen);

    try {
      await sendMessage(
        actor,
        { message: 'Hammasini tekshir.' },
        {
          provider: createScriptedProvider([
            {
              content: '',
              toolCalls: probes.map((probe) => toolCall(probe.tool.name)),
            },
            { content: 'Tayyor.' },
          ]),
          registry: createProbeRegistry(probes.map((probe) => probe.tool)),
          limits,
        },
      );
    } finally {
      stop();
    }

    const order = seen
      .filter((event) => event.type === 'tool.started' || event.type === 'tool.completed')
      .map((event) => event.type);

    // Three starts before the first completion: the UI can draw all three
    // spinning at once, which is what actually happened.
    expect(order.slice(0, 3)).toEqual(['tool.started', 'tool.started', 'tool.started']);
  });

  it('reports a partial failure as a partial failure', async () => {
    const actor = await anActor();
    const good = createToolProbe({ name: 'read_sales', summary: 'Bugun 12 ta.' });
    const bad = createToolProbe({
      name: 'notion_save',
      mutates: true,
      failTimes: 99,
      error: () => ApiError.dependencyUnavailable('Notion is unreachable'),
    });
    const seen: AgentEvent[] = [];
    const stop = tapEvents(seen);

    try {
      await sendMessage(
        actor,
        { message: 'Savdoni Notionga saqla.' },
        {
          provider: createScriptedProvider([
            { content: '', toolCalls: [toolCall('read_sales'), toolCall('notion_save')] },
            { content: 'Ma’lumot tayyor, lekin saqlanmadi.' },
          ]),
          registry: createProbeRegistry([good.tool, bad.tool]),
          limits,
        },
      );
    } finally {
      stop();
    }

    const types = seen.map((event) => event.type);

    expect(types).toContain('tool.completed');
    expect(types).toContain('tool.failed');
    // The run still finished: one failed step does not become a failed turn.
    expect(types).toContain('agent.completed');
  });

  it('asks for confirmation with an id and an expiry, and no arguments', async () => {
    const actor = await anActor();
    const probe = createToolProbe({
      name: 'crm_invoice',
      mutates: true,
      requiresConfirmation: true,
    });
    const seen: AgentEvent[] = [];
    const stop = tapEvents(seen);

    try {
      await sendMessage(
        actor,
        { message: 'Invoice yarat.' },
        {
          provider: createScriptedProvider([
            {
              content: '',
              toolCalls: [toolCall('crm_invoice', { customerId: 'c-1', amount: 1_200_000 })],
            },
            { content: 'Yarataymi?' },
          ]),
          registry: createProbeRegistry([probe.tool]),
          limits,
        },
      );
    } finally {
      stop();
    }

    const asked = seen.find((event) => event.type === 'confirmation.required');
    const typed = asked ? toStreamEvent(asked) : null;

    expect(typed).toMatchObject({ type: 'confirmation.required', toolName: 'crm_invoice' });
    expect((typed as { pendingActionId: string }).pendingActionId).toMatch(/^[0-9a-f]{24}$/);
    expect(Date.parse((typed as { expiresAt: string }).expiresAt)).toBeGreaterThan(Date.now());
    // The amount stays on the server; only the description crosses the wire.
    expect(JSON.stringify(seen)).not.toContain('1200000');
  });

  it('says when a run was cancelled', async () => {
    const actor = await anActor();
    const slow = createToolProbe({ name: 'read_slow', delayMs: 150 });
    const conversation = await conversationService.createConversation(actor, { title: 'Long' });
    const conversationId = String(conversation._id);
    const seen: AgentEvent[] = [];
    const stop = tapEvents(seen);

    const running = sendMessage(
      actor,
      { conversationId, message: 'Uzoq ish.' },
      {
        provider: createScriptedProvider([
          { content: '', toolCalls: [toolCall('read_slow')] },
          { content: '', toolCalls: [toolCall('read_slow')] },
          { content: 'Tugadi.' },
        ]),
        registry: createProbeRegistry([slow.tool]),
        limits,
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 40));
    cancelConversationRuns(actor.id, conversationId);

    await running;
    stop();

    expect(seen.map((event) => event.type)).toContain('agent.cancelled');
  });

  it('keeps MCP provenance on the events, so the answer stays attributable', async () => {
    const actor = await anActor();
    const scripted = createScriptedMcp({
      tools: SCRIPTED_CRM_TOOLS,
      results: { search_customers: 'Azamjon Sobirov' },
    });
    setMcpClientFactory(scripted.factory);

    const created = await createIntegration(actor, {
      provider: 'custom_mcp',
      name: 'My CRM',
      serverUrl: 'https://crm.example.com/mcp',
      transport: 'http',
      authMethod: 'bearer',
      secret: 'crm-secret-token',
    });
    const { integration } = await connectIntegration(actor, String(created._id));
    const toolName = mcpToolRegistryName(String(integration._id), 'search_customers');

    const seen: AgentEvent[] = [];
    const stop = tapEvents(seen);

    try {
      await sendMessage(
        actor,
        { message: 'CRMdagi Azamjonni top.' },
        {
          provider: createScriptedProvider([
            { content: '', toolCalls: [toolCall(toolName, { query: 'Azamjon' })] },
            { content: 'Topildi.' },
          ]),
          registry: await buildActorToolRegistry(actor),
          limits,
        },
      );
    } finally {
      stop();
    }

    const started = seen.find((event) => event.type === 'tool.started');
    const typed = started ? toStreamEvent(started) : null;

    expect(typed).toMatchObject({
      type: 'tool.started',
      integration: 'My CRM',
      // The person sees the server's own tool name, never Hadiya's namespaced
      // registry id.
      displayName: 'My CRM: Search customers',
    });
    expect(JSON.stringify(seen)).not.toContain('crm-secret-token');
  });
});

/* -------------------------------------------------------------------------- */
/* Assistant text as it is written                                            */
/* -------------------------------------------------------------------------- */

describe('assistant deltas', () => {
  it('streams the answer in pieces and closes the message', async () => {
    const session = await aSession();
    setAiProvider(
      createScriptedProvider([{ content: 'Bugungi savdo yaxshi.' }], {
        streaming: true,
        chunkSize: 5,
      }),
    );

    const response = await request(app)
      .post('/api/v1/ai/chat?stream=1')
      .set('Authorization', session.authorization)
      .send({ message: 'Savdo?' });

    const frames = parseSse(response.text);
    const events = eventsOf(frames);
    const deltas = events
      .filter((event) => event.type === 'assistant.delta')
      .map((event) => toStreamEvent(event))
      .map((event) => (event as { delta: string }).delta);

    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.join('')).toBe('Bugungi savdo yaxshi.');
    expect(events.some((event) => event.type === 'assistant.completed')).toBe(true);

    // The pieces are a view of the same answer, never a different one.
    expect(frameOf(frames, 'result')?.response.message.content).toBe('Bugungi savdo yaxshi.');
  });

  it('does not invent deltas when the provider cannot stream', async () => {
    const session = await aSession();
    setAiProvider(createScriptedProvider([{ content: 'Bugungi savdo yaxshi.' }]));

    const response = await request(app)
      .post('/api/v1/ai/chat?stream=1')
      .set('Authorization', session.authorization)
      .send({ message: 'Savdo?' });

    const events = eventsOf(parseSse(response.text));

    expect(events.some((event) => event.type === 'assistant.delta')).toBe(false);
    // The tool and lifecycle events still stream; only the text arrives whole.
    expect(events.some((event) => event.type === 'agent.completed')).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Rejoining, replaying and cleaning up                                       */
/* -------------------------------------------------------------------------- */

describe('the run registry', () => {
  const anOpenRun = (userId: string, conversationId = 'conversation-1') => {
    const runId = 'run-1';

    runRegistry.openRun({ runId, conversationId, userId });

    return runId;
  };

  const anEvent = (runId: string, sequence: number, type: AgentEvent['type']): AgentEvent => ({
    type,
    sequence,
    at: new Date().toISOString(),
    workflowId: runId,
    conversationId: 'conversation-1',
    data: {},
  });

  it('replays what a reconnecting client missed, and nothing it already had', async () => {
    const actor = await anActor();
    const runId = anOpenRun(actor.id);
    const received: AgentStreamFrame[] = [];

    // Three events happen while nobody is watching.
    for (const sequence of [1, 2, 3]) {
      publishAgentEvent(anEvent(runId, sequence, 'tool.started'));
    }

    const subscription = runRegistry.subscribeToRun({
      runId,
      userId: actor.id,
      afterSequence: 2,
      onFrame: (frame) => received.push(frame),
    });

    // Only what came after the last id the client saw.
    expect(
      subscription.replay
        .filter((frame) => frame.frame === 'event')
        .map((frame) => (frame as { event: AgentEvent }).event.sequence),
    ).toEqual([3]);

    publishAgentEvent(anEvent(runId, 4, 'tool.completed'));

    expect(received).toHaveLength(1);
    subscription.unsubscribe();
  });

  it('replays everything when the client has seen nothing', async () => {
    const actor = await anActor();
    const runId = anOpenRun(actor.id);

    for (const sequence of [1, 2, 3]) {
      publishAgentEvent(anEvent(runId, sequence, 'tool.started'));
    }

    const subscription = runRegistry.subscribeToRun({
      runId,
      userId: actor.id,
      onFrame: () => undefined,
    });

    expect(subscription.replay).toHaveLength(3);
    subscription.unsubscribe();
  });

  it('gives one account nothing from another account’s run', async () => {
    const owner = await anActor();
    const stranger = await anActor();
    const runId = anOpenRun(owner.id);

    expect(() =>
      runRegistry.subscribeToRun({ runId, userId: stranger.id, onFrame: () => undefined }),
    ).toThrow(/not available/i);
    expect(() => runRegistry.runSnapshot(runId, stranger.id)).toThrow(/not available/i);
  });

  it('fans one event out to every watcher', async () => {
    const actor = await anActor();
    const runId = anOpenRun(actor.id);
    const first: AgentStreamFrame[] = [];
    const second: AgentStreamFrame[] = [];

    const a = runRegistry.subscribeToRun({
      runId,
      userId: actor.id,
      onFrame: (frame) => first.push(frame),
    });
    const b = runRegistry.subscribeToRun({
      runId,
      userId: actor.id,
      onFrame: (frame) => second.push(frame),
    });

    expect(runRegistry.subscriberCount(runId)).toBe(2);

    publishAgentEvent(anEvent(runId, 1, 'tool.started'));

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);

    a.unsubscribe();
    b.unsubscribe();
    expect(runRegistry.subscriberCount(runId)).toBe(0);
  });

  it('stops writing to a watcher that has gone', async () => {
    const actor = await anActor();
    const runId = anOpenRun(actor.id);
    const received: AgentStreamFrame[] = [];

    const subscription = runRegistry.subscribeToRun({
      runId,
      userId: actor.id,
      onFrame: (frame) => received.push(frame),
    });

    subscription.unsubscribe();
    publishAgentEvent(anEvent(runId, 1, 'tool.started'));

    expect(received).toHaveLength(0);
    expect(runRegistry.subscriberCount(runId)).toBe(0);
  });

  it('answers a run that has already finished without waiting for one that will not come', async () => {
    const actor = await anActor();
    const runId = anOpenRun(actor.id);

    publishAgentEvent(anEvent(runId, 1, 'tool.started'));
    runRegistry.closeRun(runId, {
      response: {
        conversationId: 'conversation-1',
        message: { id: 'm-1', content: 'Tayyor.' } as never,
        usedMemories: [],
        pendingMemories: [],
      },
    });

    const subscription = runRegistry.subscribeToRun({
      runId,
      userId: actor.id,
      onFrame: () => undefined,
    });

    expect(subscription.finished).toBe(true);
    expect(subscription.replay.at(-1)?.frame).toBe('result');
    expect(runRegistry.subscriberCount(runId)).toBe(0);
  });

  it('finds the newest run in a conversation, for a browser that reloaded', async () => {
    const actor = await anActor();

    runRegistry.openRun({ runId: 'run-a', conversationId: 'c-1', userId: actor.id });
    runRegistry.openRun({ runId: 'run-b', conversationId: 'c-1', userId: actor.id });

    const found = runRegistry.latestRunForConversation(actor.id, 'c-1');

    expect(found?.runId).toBe('run-b');
    expect(found?.active).toBe(true);
    expect(runRegistry.latestRunForConversation(actor.id, 'c-2')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Rejoining over HTTP                                                        */
/* -------------------------------------------------------------------------- */

describe('GET /api/v1/ai/runs/:runId', () => {
  it('is refused without a token', async () => {
    const response = await request(app).get('/api/v1/ai/runs/2f9b1c66-0f4c-4a2f-8f1e-0b5f8d3a6d21');

    expect(response.status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });

  it('rejects a run id that is not one', async () => {
    const session = await aSession();
    const response = await request(app)
      .get('/api/v1/ai/runs/not-a-run')
      .set('Authorization', session.authorization);

    expect(response.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
  });

  it('answers with the events of a finished run', async () => {
    const session = await aSession();
    setAiProvider(createScriptedProvider([{ content: 'Salom!' }]));

    const streamed = await request(app)
      .post('/api/v1/ai/chat?stream=1')
      .set('Authorization', session.authorization)
      .send({ message: 'Salom' });

    const runId = frameOf(parseSse(streamed.text), 'ready')?.runId ?? '';

    const response = await request(app)
      .get(`/api/v1/ai/runs/${runId}`)
      .set('Authorization', session.authorization);

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data.active).toBe(false);
    expect(response.body.data.state).toBe('completed');
    expect(response.body.data.events.length).toBeGreaterThan(0);
  });

  it('will not show one employee another’s run', async () => {
    const session = await aSession();
    const stranger = await aSession();
    setAiProvider(createScriptedProvider([{ content: 'Salom!' }]));

    const streamed = await request(app)
      .post('/api/v1/ai/chat?stream=1')
      .set('Authorization', session.authorization)
      .send({ message: 'Salom' });

    const runId = frameOf(parseSse(streamed.text), 'ready')?.runId ?? '';

    const response = await request(app)
      .get(`/api/v1/ai/runs/${runId}`)
      .set('Authorization', stranger.authorization);

    expect(response.status).toBe(HTTP_STATUS.NOT_FOUND);
  });

  it('replays a finished run over the stream, honouring Last-Event-ID', async () => {
    const session = await aSession();
    setAiProvider(createScriptedProvider([{ content: 'Salom!' }]));

    const streamed = await request(app)
      .post('/api/v1/ai/chat?stream=1')
      .set('Authorization', session.authorization)
      .send({ message: 'Salom' });

    const runId = frameOf(parseSse(streamed.text), 'ready')?.runId ?? '';

    const all = await request(app)
      .get(`/api/v1/ai/runs/${runId}/stream`)
      .set('Authorization', session.authorization);

    const resumed = await request(app)
      .get(`/api/v1/ai/runs/${runId}/stream`)
      .set('Authorization', session.authorization)
      .set('Last-Event-ID', '2');

    const allEvents = eventsOf(parseSse(all.text));
    const resumedEvents = eventsOf(parseSse(resumed.text));

    expect(allEvents.length).toBeGreaterThan(resumedEvents.length);
    // Nothing the client already had is sent again, which is what stops a
    // reconnection drawing every completed step a second time.
    expect(resumedEvents.every((event) => event.sequence > 2)).toBe(true);
    expect(frameOf(parseSse(resumed.text), 'result')).toBeDefined();
  });

  it('refuses a stranger’s run inside the stream rather than by status', async () => {
    const session = await aSession();
    const stranger = await aSession();
    setAiProvider(createScriptedProvider([{ content: 'Salom!' }]));

    const streamed = await request(app)
      .post('/api/v1/ai/chat?stream=1')
      .set('Authorization', session.authorization)
      .send({ message: 'Salom' });

    const runId = frameOf(parseSse(streamed.text), 'ready')?.runId ?? '';

    const response = await request(app)
      .get(`/api/v1/ai/runs/${runId}/stream`)
      .set('Authorization', stranger.authorization);

    expect(frameOf(parseSse(response.text), 'error')?.message).toMatch(/not available/i);
  });
});

describe('GET /api/v1/ai/chat/:conversationId/run', () => {
  it('finds the run a reloaded browser was watching', async () => {
    const session = await aSession();
    setAiProvider(createScriptedProvider([{ content: 'Salom!' }]));

    const streamed = await request(app)
      .post('/api/v1/ai/chat?stream=1')
      .set('Authorization', session.authorization)
      .send({ message: 'Salom' });

    const result = frameOf(parseSse(streamed.text), 'result');
    const conversationId = result?.response.conversationId ?? '';

    const response = await request(app)
      .get(`/api/v1/ai/chat/${conversationId}/run`)
      .set('Authorization', session.authorization);

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data.run.state).toBe('completed');
  });

  it('will not look inside another employee’s conversation', async () => {
    const owner = await anActor();
    const stranger = await aSession();
    const conversation = await conversationService.createConversation(owner, { title: 'Mine' });

    const response = await request(app)
      .get(`/api/v1/ai/chat/${String(conversation._id)}/run`)
      .set('Authorization', stranger.authorization);

    expect(response.status).toBe(HTTP_STATUS.NOT_FOUND);
  });
});
