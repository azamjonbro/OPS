import type { AiCompletion, AiProvider } from './provider/ai-provider.js';

/**
 * A scripted model, for tests.
 *
 * Automated tests never call a paid API: the agent is written against the
 * provider interface, so a suite can hand it a fixed sequence of completions
 * and assert on exactly what the model was shown.
 */
export interface ScriptedProvider extends AiProvider {
  /** Every request the agent made, in order. */
  readonly requests: Array<{ messages: unknown[]; toolNames: string[] }>;
}

export const createScriptedProvider = (
  completions: Array<Partial<AiCompletion>>,
): ScriptedProvider => {
  const requests: Array<{ messages: unknown[]; toolNames: string[] }> = [];
  let index = 0;

  return {
    name: 'scripted',
    isConfigured: true,
    requests,
    complete: async (request) => {
      requests.push({
        messages: request.messages,
        toolNames: request.tools.map((tool) => tool.name),
      });

      const scripted = completions[index] ?? completions.at(-1) ?? {};
      index += 1;

      return {
        content: scripted.content ?? 'Understood.',
        toolCalls: scripted.toolCalls ?? [],
        model: scripted.model ?? 'scripted-model',
        usage: scripted.usage ?? { promptTokens: 10, completionTokens: 5 },
      };
    },
  };
};
