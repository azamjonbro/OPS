import { beforeEach, describe, expect, it } from 'vitest';

import {
  applyAgentEvent,
  emptyRun,
  failureSummary,
  isConfirmationLive,
  isRunActive,
  type AgentRun,
} from '@/chat/agent-run';
import { makeAgentEvent, makeToolEvent, resetAgentEventSequence } from '@/test/factories';

/**
 * Folding a run's events into something a person can read.
 *
 * The reducer is where the interface's honesty is decided: every row on screen
 * comes out of here, and nothing goes in that the server did not send. So the
 * tests are mostly about what it *refuses* to do — invent a step, draw one
 * twice, imply an order that was not there.
 */

let run: AgentRun;

beforeEach(() => {
  resetAgentEventSequence();
  run = emptyRun();
});

describe('reading events', () => {
  it('starts a run and puts a step on the timeline', () => {
    applyAgentEvent(run, makeAgentEvent('agent.started', { tools: 14 }));
    applyAgentEvent(run, makeToolEvent('tool.started', { attempt: 1 }));

    expect(run.state).toBe('running');
    expect(isRunActive(run)).toBe(true);
    expect(run.steps).toEqual([
      expect.objectContaining({
        callId: 'call-1',
        displayName: 'Sales figures',
        runningLabel: 'Reading the sales figures',
        status: 'running',
        integration: 'Billz',
      }),
    ]);
  });

  it('uses the label the server sent, not one it made up from the tool name', () => {
    applyAgentEvent(
      run,
      makeToolEvent('tool.started', {
        tool: 'mcp.65f1a2b3c4d5e6f708091a2b.search_customers',
        displayName: 'My CRM: Search customers',
        runningLabel: 'Search customers — My CRM',
        doneLabel: 'Search customers — My CRM',
        integration: 'My CRM',
      }),
    );

    // The namespaced registry name is an internal identifier. It is kept on the
    // step for keying and diagnosis, and none of the three labels — which are
    // the only strings that reach a screen — is derived from it.
    const step = run.steps[0];

    expect(step?.displayName).toBe('My CRM: Search customers');
    expect(step?.runningLabel).toBe('Search customers — My CRM');
    expect(step?.doneLabel).toBe('Search customers — My CRM');
    expect([step?.displayName, step?.runningLabel, step?.doneLabel].join(' ')).not.toContain(
      'mcp.',
    );
  });

  it('updates the step a result belongs to rather than adding another', () => {
    applyAgentEvent(run, makeToolEvent('tool.started'));
    applyAgentEvent(run, makeToolEvent('tool.completed', { durationMs: 210, attempts: 1 }));

    expect(run.steps).toHaveLength(1);
    expect(run.steps[0]).toMatchObject({ status: 'completed', durationMs: 210 });
  });

  it('ignores an event it has already applied', () => {
    const started = makeToolEvent('tool.started');

    applyAgentEvent(run, started);
    const applied = applyAgentEvent(run, started);

    expect(applied).toBe(false);
    expect(run.steps).toHaveLength(1);
  });

  it('ignores an event that arrives out of order behind one already applied', () => {
    applyAgentEvent(run, makeToolEvent('tool.started', {}));
    const stale = makeAgentEvent('agent.started', {}, { sequence: 1 });

    expect(applyAgentEvent(run, stale)).toBe(false);
    expect(run.state).toBe('idle');
  });

  it('skips an event kind it does not know, and keeps its place in the stream', () => {
    const unknown = makeAgentEvent(
      'agent.thinking',
      {},
      {
        type: 'something.new' as never,
        sequence: 7,
      },
    );

    expect(applyAgentEvent(run, unknown)).toBe(false);
    // The sequence still advances: a resume must not ask for it again.
    expect(run.lastSequence).toBe(7);
  });
});

describe('showing work that happened at the same time', () => {
  it('groups steps that started while another was still running', () => {
    applyAgentEvent(run, makeToolEvent('tool.started', { callId: 'a', displayName: 'Sales' }));
    applyAgentEvent(run, makeToolEvent('tool.started', { callId: 'b', displayName: 'Expenses' }));
    applyAgentEvent(run, makeToolEvent('tool.started', { callId: 'c', displayName: 'Debts' }));

    expect(run.steps.map((step) => step.wave)).toEqual([1, 1, 1]);
  });

  it('starts a new group once everything before it has finished', () => {
    applyAgentEvent(run, makeToolEvent('tool.started', { callId: 'a' }));
    applyAgentEvent(run, makeToolEvent('tool.completed', { callId: 'a' }));
    applyAgentEvent(run, makeToolEvent('tool.started', { callId: 'b' }));

    // Sequential work must not be drawn as concurrent, any more than the
    // reverse: the second step waited, and the timeline says so.
    expect(run.steps.map((step) => step.wave)).toEqual([1, 2]);
  });
});

describe('when something goes wrong', () => {
  it('marks a failed step with the server’s own words', () => {
    applyAgentEvent(run, makeToolEvent('tool.started'));
    applyAgentEvent(
      run,
      makeToolEvent('tool.failed', { attempts: 1, message: 'Notion is unreachable' }),
    );

    expect(run.steps[0]).toMatchObject({ status: 'failed', message: 'Notion is unreachable' });
  });

  it('shows a retry on the row it belongs to rather than as a new step', () => {
    applyAgentEvent(run, makeToolEvent('tool.started', { attempt: 1 }));
    applyAgentEvent(run, makeToolEvent('tool.retrying', { attempt: 1 }));
    applyAgentEvent(run, makeToolEvent('tool.started', { attempt: 2 }));
    applyAgentEvent(run, makeToolEvent('tool.completed', { attempts: 2, durationMs: 400 }));

    expect(run.steps).toHaveLength(1);
    expect(run.steps[0]).toMatchObject({ status: 'completed', attempts: 2 });
  });

  it('records a step that failed before it ever started', () => {
    applyAgentEvent(
      run,
      makeToolEvent('tool.failed', {
        callId: 'call-9',
        message: 'That step is not available.',
        attempts: 0,
      }),
    );

    expect(run.steps).toHaveLength(1);
    expect(run.steps[0]?.status).toBe('failed');
  });

  it('counts what worked and what did not, in checkable numbers', () => {
    applyAgentEvent(run, makeToolEvent('tool.started', { callId: 'a', displayName: 'Sales' }));
    applyAgentEvent(run, makeToolEvent('tool.completed', { callId: 'a' }));
    applyAgentEvent(run, makeToolEvent('tool.started', { callId: 'b', displayName: 'Notion' }));
    applyAgentEvent(run, makeToolEvent('tool.failed', { callId: 'b', message: 'unreachable' }));

    expect(failureSummary(run)).toBe('1 of 2 steps finished. Notion did not.');
  });

  it('says nothing when nothing failed', () => {
    applyAgentEvent(run, makeToolEvent('tool.started'));
    applyAgentEvent(run, makeToolEvent('tool.completed'));

    expect(failureSummary(run)).toBeNull();
  });

  it('reports a run that could not finish, in the server’s words', () => {
    applyAgentEvent(run, makeAgentEvent('agent.failed', { message: 'The model is unavailable.' }));

    expect(run.state).toBe('failed');
    expect(run.error).toBe('The model is unavailable.');
    expect(isRunActive(run)).toBe(false);
  });
});

describe('the answer as it is written', () => {
  it('accumulates deltas belonging to one message', () => {
    applyAgentEvent(
      run,
      makeAgentEvent('assistant.delta', { messageId: 'm-1', delta: 'Bugungi ' }),
    );
    applyAgentEvent(run, makeAgentEvent('assistant.delta', { messageId: 'm-1', delta: 'savdo' }));

    expect(run.streamingText).toBe('Bugungi savdo');
  });

  it('starts again when a later round begins its own message', () => {
    applyAgentEvent(
      run,
      makeAgentEvent('assistant.delta', { messageId: 'm-1', delta: 'Tekshiryapman' }),
    );
    applyAgentEvent(
      run,
      makeAgentEvent('assistant.delta', { messageId: 'm-2', delta: 'Bugun 12 ta' }),
    );

    // The earlier round's text was the model thinking aloud before it reached
    // for a tool; the answer being written now replaces it.
    expect(run.streamingText).toBe('Bugun 12 ta');
  });
});

describe('waiting on a person', () => {
  const askFor = (expiresAt: string) =>
    makeAgentEvent('confirmation.required', {
      callId: 'call-1',
      pendingActionId: 'pa-1',
      tool: 'crm_invoice',
      displayName: 'Invoice',
      title: 'Invoice',
      description: 'create an invoice for 1 200 000 UZS',
      integration: 'My CRM',
      expiresAt,
    });

  it('holds the proposal and stops the run counting as merely running', () => {
    applyAgentEvent(run, askFor(new Date(Date.now() + 300_000).toISOString()));

    expect(run.state).toBe('waiting_confirmation');
    expect(run.confirmation).toMatchObject({
      pendingActionId: 'pa-1',
      description: 'create an invoice for 1 200 000 UZS',
    });
    expect(isConfirmationLive(run.confirmation)).toBe(true);
    // Still active: the turn is not over, it is waiting.
    expect(isRunActive(run)).toBe(true);
  });

  it('treats a lapsed proposal as no longer answerable', () => {
    applyAgentEvent(run, askFor(new Date(Date.now() - 1_000).toISOString()));

    expect(isConfirmationLive(run.confirmation)).toBe(false);
  });

  it('keeps waiting even after the run reports itself complete', () => {
    applyAgentEvent(run, askFor(new Date(Date.now() + 300_000).toISOString()));
    applyAgentEvent(run, makeAgentEvent('agent.completed', { state: 'waiting_for_confirmation' }));

    expect(run.state).toBe('waiting_confirmation');
  });

  it('withdraws the proposal when the run is cancelled', () => {
    applyAgentEvent(run, askFor(new Date(Date.now() + 300_000).toISOString()));
    applyAgentEvent(run, makeAgentEvent('agent.cancelled', {}));

    expect(run.state).toBe('cancelled');
    expect(run.confirmation).toBeNull();
    expect(isRunActive(run)).toBe(false);
  });
});

describe('a whole workflow', () => {
  it('produces a truthful timeline for a run that partly failed', () => {
    const step = (callId: string, displayName: string) => ({ callId, displayName });

    applyAgentEvent(run, makeAgentEvent('agent.started', { tools: 20 }));

    for (const [callId, displayName] of [
      ['billz', 'Sales figures'],
      ['content', 'Content plan'],
      ['image', 'Image'],
      ['notion', 'Notion'],
    ] as const) {
      applyAgentEvent(run, makeToolEvent('tool.started', step(callId, displayName)));
      applyAgentEvent(
        run,
        callId === 'notion'
          ? makeToolEvent('tool.failed', {
              ...step(callId, displayName),
              message: 'Notion is unreachable',
              attempts: 1,
            })
          : makeToolEvent('tool.completed', { ...step(callId, displayName), durationMs: 100 }),
      );
    }

    applyAgentEvent(run, makeAgentEvent('agent.completed', { state: 'recovering' }));

    expect(run.steps.map((entry) => [entry.displayName, entry.status])).toEqual([
      ['Sales figures', 'completed'],
      ['Content plan', 'completed'],
      ['Image', 'completed'],
      ['Notion', 'failed'],
    ]);
    // Four steps, run one after another, and the timeline says so rather than
    // grouping them as though they had been concurrent.
    expect(run.steps.map((entry) => entry.wave)).toEqual([1, 2, 3, 4]);
    expect(failureSummary(run)).toBe('3 of 4 steps finished. Notion did not.');
    expect(run.state).toBe('completed');
  });
});
