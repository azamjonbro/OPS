/**
 * Drives the agent against the real model and the real integrations, and
 * reports what it did.
 *
 * A read-only smoke test for a configured environment: it answers whether the
 * loop, the tool registry and the connected services actually work together on
 * this deployment, which no scripted test can tell you.
 *
 *   npm run probe-agent -w @hadiya/api
 *
 * **It costs money.** Every question here is a real completion against the
 * configured provider, so run it deliberately rather than in a loop.
 *
 * Nothing it does can change data. The registry is filtered to `mutates: false`
 * tools before the agent is given it, so no memory, content plan, image,
 * reminder or integration write is reachable however the model reads the
 * question — the guarantee is structural rather than a matter of prompting.
 * What it does write is a conversation and its messages, which is what a turn
 * is, into whichever database `MONGO_URI` names.
 */
import type { AuthenticatedUser } from '@hadiya/shared';

import { connectDatabase, disconnectDatabase } from '../core/db/connection.js';
import { logger } from '../core/logger/logger.js';
import { sendMessage } from '../modules/ai/agent/agent.service.js';
import { describeAiProvider } from '../modules/ai/provider/index.js';
import { buildActorToolRegistry } from '../modules/ai/tools/index.js';
import { ToolRegistry } from '../modules/ai/tools/tool-registry.js';
import { UserModel } from '../modules/users/user.model.js';

/** The same registry the agent would build, with everything that writes removed. */
const readOnly = (source: ToolRegistry): ToolRegistry => {
  const safe = new ToolRegistry();

  for (const tool of source.list()) {
    if (!tool.mutates) {
      safe.register(tool);
    }
  }

  return safe;
};

const QUESTIONS = [
  'Salom, o‘zingni qisqacha tanishtir.',
  'Bugungi savdo qanday?',
  'Bugungi va kechagi savdoni solishtir va qisqacha xulosa qil.',
];

const run = async (): Promise<void> => {
  await connectDatabase();

  try {
    const user = await UserModel.findOne({ status: 'active' }).lean().exec();

    if (!user) {
      throw new Error('No active user in this database to act as.');
    }

    const actor: AuthenticatedUser = {
      id: String(user._id),
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      branchId: user.branch ? String(user.branch) : null,
      timezone: user.timezone,
    };

    const registry = readOnly(await buildActorToolRegistry(actor));

    logger.info(
      { provider: describeAiProvider(), actor: actor.username, tools: registry.list().length },
      'probing the agent',
    );

    let conversationId: string | undefined;

    for (const question of QUESTIONS) {
      const startedAt = Date.now();
      const result = await sendMessage(
        actor,
        { conversationId, message: question },
        { registry, limits: { maxToolRounds: 4, maxModelCalls: 6 } },
      );

      conversationId = result.conversationId;

      logger.info(
        {
          question,
          answer: result.message.content.slice(0, 500),
          state: result.agent?.state,
          rounds: result.agent?.rounds,
          modelCalls: result.agent?.modelCalls,
          tokensSpent: result.agent?.tokensSpent,
          elapsedMs: Date.now() - startedAt,
          steps: result.agent?.steps.map((step) => ({
            tool: step.tool,
            outcome: step.outcome,
            source: step.provenance.source,
            durationMs: step.durationMs,
            attempts: step.attempts,
          })),
        },
        'turn finished',
      );
    }
  } finally {
    await disconnectDatabase();
  }
};

run()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    logger.fatal({ err: error }, 'the agent probe failed');
    process.exit(1);
  });
