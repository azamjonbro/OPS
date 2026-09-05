import { MCP_LIMITS } from '@hadiya/shared';

import { McpError } from './mcp-error.js';

/**
 * What stops one MCP server from becoming everybody's problem.
 *
 * A tool call is a request Hadiya makes on a model's say-so to a server chosen
 * by a user, and both halves of that can go wrong without anyone acting
 * maliciously: a model that loops calls a tool forty times in a turn, and a
 * server that answers slowly ties up a connection for each one. Timeouts bound
 * a single call; these bound the aggregate.
 *
 * Three limits, because they fail differently. The per-minute budgets stop a
 * runaway loop from spending somebody else's API quota. The concurrency limit
 * stops slow servers from holding open more sockets than the process should
 * have — it is the one that protects Hadiya rather than the far side.
 *
 * State is per process and in memory. That is the right scope for what this
 * protects (this process's sockets, this process's event loop) and the honest
 * limitation for the rest: behind several API instances each keeps its own
 * count, so the effective budget multiplies by the instance count. Making it
 * exact would mean a shared store on the path of every tool call, which costs
 * more than the precision is worth — the per-call timeout is what actually
 * bounds the damage.
 */

const WINDOW_MS = 60_000;

interface Window {
  count: number;
  /** When the current minute started. */
  startedAt: number;
}

const windows = new Map<string, Window>();
const inFlight = new Map<string, number>();

/** Counts one event in a named minute-long window and reports the total. */
const record = (key: string, now: number): number => {
  const existing = windows.get(key);

  if (!existing || now - existing.startedAt >= WINDOW_MS) {
    windows.set(key, { count: 1, startedAt: now });

    return 1;
  }

  existing.count += 1;

  return existing.count;
};

/** Drops windows nobody has touched for two minutes, so the maps stay bounded. */
const sweep = (now: number): void => {
  if (windows.size < 512) {
    return;
  }

  for (const [key, window] of windows) {
    if (now - window.startedAt > WINDOW_MS * 2) {
      windows.delete(key);
    }
  }
};

export interface GuardKey {
  userId: string;
  integrationId: string;
}

/**
 * Reserves the right to make one MCP tool call.
 *
 * Returns a release function, which the caller must run in a `finally`. Written
 * as a reservation rather than a check so the concurrency count cannot drift:
 * there is exactly one place it goes up and one place it comes down.
 */
export const acquireToolSlot = (key: GuardKey): (() => void) => {
  const now = Date.now();

  sweep(now);

  const running = inFlight.get(key.userId) ?? 0;

  if (running >= MCP_LIMITS.maxConcurrentCallsPerUser) {
    throw new McpError(
      'rate_limited',
      'Too many tool calls are already running; wait for one to finish.',
    );
  }

  if (record(`user:${key.userId}`, now) > MCP_LIMITS.callsPerMinutePerUser) {
    throw new McpError(
      'rate_limited',
      'Too many tool calls in the last minute; try again shortly.',
    );
  }

  if (
    record(`integration:${key.integrationId}`, now) > MCP_LIMITS.callsPerMinutePerIntegration
  ) {
    throw new McpError(
      'rate_limited',
      'This integration has been called too often in the last minute; try again shortly.',
    );
  }

  inFlight.set(key.userId, running + 1);

  let released = false;

  return () => {
    if (released) {
      return;
    }

    released = true;

    const current = inFlight.get(key.userId) ?? 1;

    if (current <= 1) {
      inFlight.delete(key.userId);
    } else {
      inFlight.set(key.userId, current - 1);
    }
  };
};

/** Testing seam: forgets every window and every in-flight count. */
export const resetMcpGuards = (): void => {
  windows.clear();
  inFlight.clear();
};
