import { describe, expect, it } from 'vitest';

import { ApiError } from '../../../core/http/api-error.js';
import { McpError } from '../../integrations/mcp/mcp-error.js';
import { resolveToolPlan, type RegisteredTool } from '../tools/tool-registry.js';
import { clearAgentEventListeners, createEventSink, onAgentEvent } from './agent-events.js';
import { hashArguments, redactArguments } from './pending-action.service.js';
import { backoffFor, classifyFailure, shouldRetry, ToolTimeoutError } from './tool-retry.js';

/**
 * The rules the orchestrator is built on, tested where they are decided.
 *
 * Every one of these is exercised through the agent elsewhere, but a rule that
 * can only be observed through a five-step workflow is a rule nobody can read
 * the boundary of. These are the boundaries.
 */

const planFor = (tool: Partial<RegisteredTool> & { name: string }) =>
  resolveToolPlan({
    description: '',
    schema: {
      safeParse: () => ({ success: true, data: {} }),
    } as unknown as RegisteredTool['schema'],
    mutates: false,
    ...tool,
  } as RegisteredTool);

describe('classifying a tool failure', () => {
  it('reads a timeout however it was expressed', () => {
    expect(classifyFailure(new ToolTimeoutError('slow', 1_000))).toBe('timeout');
    expect(classifyFailure(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe('timeout');
    expect(classifyFailure(new Error('the request timed out'))).toBe('timeout');
  });

  it('separates a busy service from a broken request', () => {
    expect(classifyFailure(ApiError.rateLimited())).toBe('rate_limited');
    expect(classifyFailure(ApiError.dependencyUnavailable('down'))).toBe('unavailable');
    expect(classifyFailure(ApiError.badRequest('bad dates'))).toBe('invalid');
    expect(classifyFailure(ApiError.forbidden())).toBe('not_allowed');
    expect(classifyFailure(new Error('ECONNRESET'))).toBe('network');
  });

  it('reads an MCP failure by its own kind rather than by its text', () => {
    expect(classifyFailure(new McpError('unreachable'))).toBe('network');
    expect(classifyFailure(new McpError('authentication'))).toBe('authentication');
    // The tool ran and said no. Asking again gets the same no.
    expect(classifyFailure(new McpError('tool_failed'))).toBe('invalid');
  });

  it('treats anything it does not recognise as not worth repeating', () => {
    expect(classifyFailure(new TypeError('cannot read properties of undefined'))).toBe('unknown');
    expect(classifyFailure('a string nobody threw on purpose')).toBe('unknown');
  });
});

describe('deciding whether to retry', () => {
  const transient = new Error('ECONNRESET');

  it('retries a read that failed transiently, within its budget', () => {
    const plan = planFor({ name: 'read_sales' });

    expect(shouldRetry({ error: transient, plan, attempt: 1, maxRetries: 2 }).retry).toBe(true);
    expect(shouldRetry({ error: transient, plan, attempt: 3, maxRetries: 2 }).retry).toBe(false);
  });

  it('never retries a write that is not safe to repeat', () => {
    const plan = planFor({ name: 'crm_invoice', mutates: true });
    const decision = shouldRetry({ error: transient, plan, attempt: 1, maxRetries: 2 });

    expect(decision.retry).toBe(false);
    expect(decision.reason).toMatch(/not safe to repeat/);
  });

  it('retries a write that says it is idempotent', () => {
    const plan = planFor({ name: 'upsert_row', mutates: true, idempotent: true });

    expect(shouldRetry({ error: transient, plan, attempt: 1, maxRetries: 2 }).retry).toBe(true);
  });

  it('never retries anything destructive, whatever went wrong', () => {
    const plan = planFor({ name: 'delete_plan', mutates: true, requiresConfirmation: true });

    expect(plan.risk).toBe('destructive');
    expect(shouldRetry({ error: transient, plan, attempt: 1, maxRetries: 2 }).retry).toBe(false);
  });

  it('does not retry a failure that will not change', () => {
    const plan = planFor({ name: 'read_sales' });
    const decision = shouldRetry({
      error: ApiError.badRequest('bad dates'),
      plan,
      attempt: 1,
      maxRetries: 2,
    });

    expect(decision.retry).toBe(false);
    expect(decision.kind).toBe('invalid');
  });

  it('backs off further on each attempt, and not at all when told not to', () => {
    expect(backoffFor(1, 0)).toBe(0);
    expect(backoffFor(2, 100)).toBeGreaterThanOrEqual(backoffFor(1, 100));
  });
});

describe('classifying a tool', () => {
  it('derives risk, parallelism and repeatability from what a tool declares', () => {
    expect(planFor({ name: 'read' })).toMatchObject({
      risk: 'read',
      parallelSafe: true,
      idempotent: true,
      resource: null,
    });

    expect(planFor({ name: 'write', mutates: true, category: 'content' })).toMatchObject({
      risk: 'write',
      parallelSafe: false,
      idempotent: false,
      resource: 'content',
    });

    // A tool that asks first is never run beside anything else: it is the one
    // call in the round a person is about to be shown.
    expect(planFor({ name: 'destroy', mutates: true, requiresConfirmation: true })).toMatchObject({
      risk: 'destructive',
      parallelSafe: false,
    });
  });
});

describe('what a proposal remembers', () => {
  it('drops anything named like a credential, and never stores the agreement itself', () => {
    const redacted = redactArguments({
      customerId: 'c-1',
      apiKey: 'sk-live-123',
      confirm: true,
    });

    expect(redacted).toEqual({ customerId: 'c-1', apiKey: '[redacted]' });
  });

  it('hashes the same arguments the same however they were written', () => {
    expect(hashArguments({ a: 1, b: 2 })).toBe(hashArguments({ b: 2, a: 1 }));
    expect(hashArguments({ a: 1 })).not.toBe(hashArguments({ a: 2 }));
  });
});

describe('agent events', () => {
  it('carries names and numbers, and nothing that came from outside', () => {
    const sink = createEventSink({ workflowId: 'w-1', conversationId: 'c-1', userId: 'u-1' });

    sink.emit('tool.started', {
      tool: 'crm_invoice',
      attempt: 1,
      apiKey: 'sk-live-123',
      arguments: { amount: 100 },
      integration: null,
    });

    expect(sink.events[0]?.data).toEqual({
      tool: 'crm_invoice',
      attempt: 1,
      integration: null,
    });
  });

  it('reaches a listener without letting a broken one end the run', () => {
    const seen: string[] = [];
    const stopBad = onAgentEvent(() => {
      throw new Error('this listener is broken');
    });
    const stopGood = onAgentEvent((event) => seen.push(event.type));

    try {
      const sink = createEventSink({ workflowId: 'w-1', conversationId: 'c-1', userId: 'u-1' });

      expect(() => sink.emit('agent.started')).not.toThrow();
      expect(seen).toEqual(['agent.started']);
    } finally {
      stopBad();
      stopGood();
      clearAgentEventListeners();
    }
  });
});
