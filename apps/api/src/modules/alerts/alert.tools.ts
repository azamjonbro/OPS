import { ALERT_SEVERITIES, ALERT_TYPES, type AlertSeverity } from '@hadiya/shared';
import { z } from 'zod';

import type { RegisteredTool, ToolContext } from '../ai/tools/tool-registry.js';
import {
  acknowledgeAlert,
  dismissAlert,
  getAlert,
  listAlerts,
  summariseAlerts,
} from './alert.service.js';
import type { AlertDocument } from './alert.model.js';

/**
 * Alerts, as things the assistant can be asked about.
 *
 * Four tools rather than the six the brief sketched: `get_active` and
 * `get_history` are the same query with a different status filter, so they are
 * one tool with an argument instead of two that would have to be kept in step.
 *
 * Nothing here can cause an evaluation to run. The scheduler decides when
 * conditions are checked, and a model that could trigger a pass could be talked
 * into hammering Billz by anybody who could type into the chat.
 */

const describe = (alert: AlertDocument): string => {
  const evidence = alert.evidence;
  const change =
    evidence.changePercent === null
      ? 'no comparable figure for the previous period'
      : `${evidence.changePercent > 0 ? '+' : ''}${evidence.changePercent}%`;

  return [
    `[${alert.severity}, ${alert.status}] ${alert.title}`,
    alert.summary,
    `Measured over ${evidence.periodFrom}–${evidence.periodTo} (${change}).`,
    alert.occurrences > 1 ? `Seen ${alert.occurrences} times since it opened.` : '',
    evidence.dataComplete ? '' : 'The figures behind this were incomplete.',
    `id ${String(alert._id)}`,
  ]
    .filter(Boolean)
    .join(' ');
};

const base = {
  mutates: false,
  category: 'business',
  risk: 'read',
  parallelSafe: true,
} as const;

const listTool: RegisteredTool = {
  ...base,
  name: 'alerts_list',
  description:
    'Business alerts Hadiya has raised for this user — unusual sales, branch declines, low stock and so on. Answers "bugun qanday alertlar bor?" and "oxirgi alertlarni ko\'rsat". Defaults to what is still open; pass includeResolved to see the history. Each alert carries the figures it was raised from, so you can explain why it fired without guessing.',
  schema: z.object({
    includeResolved: z
      .boolean()
      .default(false)
      .describe('Include resolved and dismissed alerts, i.e. the history'),
    severity: z.enum(ALERT_SEVERITIES).optional().describe('Only alerts at this severity'),
    type: z.enum(ALERT_TYPES).optional().describe('Only alerts of this type'),
    limit: z.number().int().min(1).max(50).default(10),
  }),
  execute: async (raw, context: ToolContext) => {
    const args = raw as {
      includeResolved: boolean;
      severity?: AlertSeverity;
      type?: (typeof ALERT_TYPES)[number];
      limit: number;
    };

    const result = await listAlerts(context.actor, {
      page: 1,
      pageSize: args.limit,
      activeOnly: !args.includeResolved,
      severity: args.severity,
      type: args.type,
    });

    if (result.items.length === 0) {
      return {
        summary: args.includeResolved
          ? 'No alerts have been raised for this account.'
          : 'There are no open business alerts right now.',
        data: result,
      };
    }

    return {
      summary: `${result.pagination.total} alert(s). ${result.items.map(describe).join(' | ')}`,
      data: result,
    };
  },
};

const getTool: RegisteredTool = {
  ...base,
  name: 'alerts_get',
  description:
    'One alert in full, by its id, with the figures and the period it was raised from. Use it to answer "nega bu alert chiqdi?" — explain it from the evidence, and say what the figures coincide with rather than asserting a cause.',
  schema: z.object({ alertId: z.string().trim().min(1) }),
  execute: async (raw, context: ToolContext) => {
    const { alertId } = raw as { alertId: string };
    const alert = await getAlert(context.actor, alertId);

    return {
      summary: `${describe(alert)} Evidence: ${alert.evidence.notes.join(' ') || 'the figures above.'}`,
      data: alert,
    };
  },
};

const summaryTool: RegisteredTool = {
  ...base,
  name: 'alerts_get_summary',
  description:
    'How many alerts are open and how serious they are, without listing them. Cheap; use it when the user asks whether anything needs attention.',
  schema: z.object({}),
  execute: async (_raw, context: ToolContext) => {
    const summary = await summariseAlerts(context.actor);

    if (summary.active === 0) {
      return { summary: 'Nothing needs attention: there are no open alerts.', data: summary };
    }

    const bySeverity = Object.entries(summary.bySeverity)
      .filter(([, count]) => count > 0)
      .map(([severity, count]) => `${count} ${severity}`)
      .join(', ');

    return {
      summary: `${summary.active} open alert(s) — ${bySeverity}. ${summary.unacknowledged} not yet acknowledged.`,
      data: summary,
    };
  },
};

/**
 * Acknowledging and dismissing.
 *
 * These write, and are declared as writes so the registry classifies them
 * honestly — but they change only how an alert is displayed to its own owner.
 * Nothing here touches Billz, stock, prices or money, so neither needs a
 * confirmation gate: the worst outcome is a notification marked read early,
 * which the person can undo by looking at the history.
 */
const updateTool: RegisteredTool = {
  name: 'alerts_update_status',
  category: 'business',
  mutates: true,
  risk: 'write',
  resource: 'alerts',
  description:
    'Acknowledge an alert (the user has seen it) or dismiss it (they do not want it). Use for "bu alertni o\'chirib qo\'y" or "ko\'rdim". It changes only what the user sees; it never changes anything in Billz.',
  schema: z.object({
    alertId: z.string().trim().min(1),
    action: z.enum(['acknowledge', 'dismiss']),
  }),
  execute: async (raw, context: ToolContext) => {
    const { alertId, action } = raw as { alertId: string; action: 'acknowledge' | 'dismiss' };

    const alert =
      action === 'acknowledge'
        ? await acknowledgeAlert(context.actor, alertId)
        : await dismissAlert(context.actor, alertId);

    return {
      summary: `"${alert.title}" is now ${alert.status}.`,
      data: alert,
    };
  },
};

export const ALERT_TOOLS: readonly RegisteredTool[] = [listTool, getTool, summaryTool, updateTool];
