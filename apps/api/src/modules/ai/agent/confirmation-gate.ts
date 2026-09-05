import type { AuthenticatedUser } from '@hadiya/shared';

import { config } from '../../../config/index.js';
import { createLogger } from '../../../core/logger/logger.js';
import { isConfirmed, type ToolRegistry } from '../tools/tool-registry.js';
import * as pendingActions from './pending-action.service.js';
import type { ScheduledCall } from './tool-scheduler.js';

const log = createLogger('agent-confirmation');

/**
 * The server's own answer to "did they actually agree?".
 *
 * The registry already refuses to run a confirmable tool until `confirm: true`
 * arrives in its arguments, and that flag comes from the model. On its own it
 * is a claim: the model asserts the person said yes, and the server takes its
 * word. This gate is what turns the claim into a check.
 *
 * When Hadiya asked for agreement it wrote down what it was asking about, with
 * the arguments already validated, and put a clock on it. A confirmed call is
 * matched against that record before anything runs:
 *
 *  - **Expired.** The proposal is older than the window. A person who agreed to
 *    an invoice before lunch has not agreed to one tomorrow, and the honest
 *    move is to ask again rather than to act on a stale yes.
 *  - **Changed.** The arguments are not the ones that were described. Whatever
 *    the person agreed to, it was not this, so this does not run.
 *  - **Missing.** Nothing was ever proposed. This is the only ambiguous case: a
 *    model that proposes and confirms inside one turn produces it legitimately,
 *    and so does a model that invented the agreement. Which one it is cannot be
 *    told apart from here, so it is a deployment's policy
 *    (`AGENT_REQUIRE_PENDING_CONFIRMATION`) rather than a guess made here.
 *
 * Nothing in this file trusts the client. A browser cannot mark an action
 * confirmed; it can only send a message, which the model reads, after which
 * this check still has to pass.
 */

export type GateVerdict =
  | { kind: 'allow' }
  /** The call must not run; `message` is the tool result the model will see. */
  | { kind: 'refuse'; message: string };

export interface GateInput {
  actor: AuthenticatedUser;
  conversationId: string;
  registry: ToolRegistry;
  call: ScheduledCall;
  now?: Date;
  /** Overrides the deployment policy; tests pin it. */
  requirePendingAction?: boolean;
}

/**
 * Validates the arguments the way the tool itself would.
 *
 * The stored proposal holds *validated* arguments, so a schema default would
 * otherwise make an honest confirmation look like a changed one: the proposal
 * carries `limit: 5` that the model never wrote, and the confirmation does not.
 * Parsing first means both sides of the comparison have been through the same
 * schema. A call whose arguments do not parse is waved through to the scheduler,
 * which reports the validation failure properly rather than as a confirmation
 * problem.
 */
const validatedArguments = (
  registry: ToolRegistry,
  call: ScheduledCall,
): Record<string, unknown> | null => {
  const tool = registry.get(call.name);

  if (!tool) {
    return null;
  }

  const parsed = tool.schema.safeParse(call.arguments ?? {});

  return parsed.success ? (parsed.data as Record<string, unknown>) : null;
};

export const screenConfirmation = async (input: GateInput): Promise<GateVerdict> => {
  const plan = input.registry.plan(input.call.name);

  // Nothing to check: either the tool is unknown (the scheduler refuses it) or
  // it never needed agreeing to in the first place.
  if (!plan?.requiresConfirmation) {
    return { kind: 'allow' };
  }

  // Not claiming agreement, so the registry will stop it and ask. That is the
  // path that *creates* the record this gate later checks.
  if (!isConfirmed(input.call.arguments)) {
    return { kind: 'allow' };
  }

  const args = validatedArguments(input.registry, input.call);

  if (!args) {
    return { kind: 'allow' };
  }

  const verdict = await pendingActions.consumePendingAction(input.actor, {
    conversationId: input.conversationId,
    tool: input.call.name,
    args,
    ...(input.now ? { now: input.now } : {}),
  });

  switch (verdict.kind) {
    case 'confirmed':
      return { kind: 'allow' };

    case 'expired':
      log.info(
        { user: input.actor.id, tool: input.call.name },
        'confirmation refused: the proposal had expired',
      );

      return {
        kind: 'refuse',
        message: `Not carried out: the agreement to ${verdict.action.description} has expired, so it is no longer valid. Nothing was changed. Describe the action to the user again and only call "${input.call.name}" with confirm: true after they agree afresh.`,
      };

    case 'mismatched':
      log.warn(
        { user: input.actor.id, tool: input.call.name },
        'confirmation refused: the arguments no longer match what was described',
      );

      return {
        kind: 'refuse',
        message: `Not carried out: what the user agreed to was "${verdict.action.description}", and these arguments are not that. Nothing was changed. Describe what you now intend to do and ask again.`,
      };

    case 'missing': {
      const required = input.requirePendingAction ?? config.agent.requirePendingConfirmation;

      if (!required) {
        // Permitted, but never silent: an approval nobody can point at is
        // exactly what an audit of a destructive call needs to be able to find.
        log.warn(
          { user: input.actor.id, tool: input.call.name },
          'confirmed call had no recorded proposal behind it',
        );

        return { kind: 'allow' };
      }

      return {
        kind: 'refuse',
        message: `Not carried out: Hadiya has no record of asking the user about this, so the confirmation cannot be verified. Nothing was changed. Call "${input.call.name}" without confirm first, tell the user exactly what it will do, and only confirm after they answer.`,
      };
    }
  }
};
