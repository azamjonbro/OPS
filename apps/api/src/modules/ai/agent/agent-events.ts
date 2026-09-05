import type { AgentEvent, AgentEventType } from '@hadiya/shared';

import { createLogger } from '../../../core/logger/logger.js';

const log = createLogger('agent-events');

/**
 * What a run tells the outside world while it is happening.
 *
 * Two audiences, one stream. A future streaming UI wants to draw "reading
 * today's sales…" the moment it starts rather than when the whole turn
 * finishes; whoever is on call wants a record of which tool was slow and how
 * often it was retried. Both are served by the same small, flat events, which
 * is why they are collected into the reply as well as logged.
 *
 * The rule that governs their contents is absolute and is enforced here rather
 * than trusted to call sites: an event carries names, statuses, counts and
 * durations, and nothing else. No arguments, because the model wrote them and
 * they can contain anything a person typed. No results, because an external
 * service wrote them. No credentials, ever — a token has no business in a
 * payload designed to be pushed to a browser.
 */

/** Values an event payload may carry. Anything else is dropped by `sanitise`. */
type EventValue = string | number | boolean | null;

/** Keys that must never appear in an event, whatever a caller believed. */
const FORBIDDEN_KEY = /(token|secret|password|credential|api[_-]?key|authorization|cookie)/i;

/** Longest string an event field may carry before it is cut short. */
const MAX_VALUE_LENGTH = 200;

const sanitise = (data: Record<string, unknown>): Record<string, EventValue> => {
  const safe: Record<string, EventValue> = {};

  for (const [key, value] of Object.entries(data)) {
    if (FORBIDDEN_KEY.test(key)) {
      continue;
    }

    if (value === null || typeof value === 'boolean' || typeof value === 'number') {
      safe[key] = value;
      continue;
    }

    if (typeof value === 'string') {
      safe[key] = value.slice(0, MAX_VALUE_LENGTH);
    }

    // Objects and arrays are dropped rather than serialised: whatever is in
    // them was not written with this stream in mind.
  }

  return safe;
};

export interface AgentEventSink {
  emit: (type: AgentEventType, data?: Record<string, unknown>) => void;
  /** Everything emitted so far, in order. */
  readonly events: AgentEvent[];
}

/** A listener on every run in the process, for logging and future streaming. */
export type AgentEventListener = (event: AgentEvent) => void;

const listeners = new Set<AgentEventListener>();

/**
 * Subscribes to every agent event in this process.
 *
 * The seam a streaming transport plugs into later: an SSE handler registers
 * here, filters by workflow id and writes each event out. Returns its own
 * unsubscribe, so a caller cannot leak a listener by losing the reference.
 */
export const onAgentEvent = (listener: AgentEventListener): (() => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

/** Testing seam: forgets every listener. */
export const clearAgentEventListeners = (): void => {
  listeners.clear();
};

export interface EventSinkOptions {
  workflowId: string;
  conversationId: string;
  userId: string;
  /** Keeps the reply bounded when a long run emits a great many events. */
  maxEvents?: number;
}

/** Events kept in one run's reply. Beyond this the oldest are forgotten. */
const MAX_EVENTS = 200;

export const createEventSink = (options: EventSinkOptions): AgentEventSink => {
  const events: AgentEvent[] = [];
  const limit = options.maxEvents ?? MAX_EVENTS;
  let sequence = 0;

  return {
    events,
    emit: (type, data = {}) => {
      sequence += 1;

      const event: AgentEvent = {
        type,
        sequence,
        at: new Date().toISOString(),
        workflowId: options.workflowId,
        conversationId: options.conversationId,
        data: sanitise(data),
      };

      events.push(event);

      // The oldest go first: the tail is what explains how a run ended, and
      // that is the half worth keeping when only half fits.
      if (events.length > limit) {
        events.shift();
      }

      // One structured line per event. The user id is here and not in the
      // event itself, because the event is sent to a browser and the log is
      // not — the browser already knows who it is.
      log.debug({ user: options.userId, workflow: options.workflowId, ...event }, type);

      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          // A broken listener must not take a run down with it.
          log.warn({ err: error }, 'agent event listener failed');
        }
      }
    },
  };
};
