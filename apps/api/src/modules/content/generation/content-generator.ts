import { CONTENT_GENERATION_MAX_ATTEMPTS } from '@hadiya/shared';
import type { z } from 'zod';

import { createLogger } from '../../../core/logger/logger.js';
import {
  getAiProvider,
  isAiProviderError,
  type AiPromptMessage,
  type AiProvider,
} from '../../ai/provider/index.js';
import { buildRepairInstruction, type StructuredBrief } from './content-prompts.js';
import { parseStructured } from './structured-output.js';

const log = createLogger('content-generator');

/**
 * One structured request to the model, validated before it is believed.
 *
 * This is where the content engine talks to a model, and it is deliberately the
 * only place. The conversational agent runs a tool loop and produces prose; this
 * runs a single call with no tools and produces an object of a known shape. They
 * are different jobs with different failure modes, and merging them would mean
 * the agent's tool-calling loop had to also be a JSON validator.
 *
 * A malformed reply is retried once, with the validation errors handed back to
 * the model — which fixes the common case, a missed field or a stray fence,
 * without turning a failing prompt into an unbounded spend. After that the
 * failure is returned, never thrown past the caller as a surprise, and nothing
 * unvalidated is ever passed on to be stored.
 */

export type GenerationOutcome<TData> =
  | { ok: true; data: TData; model: string; attempts: number }
  | { ok: false; message: string; issues: string[]; attempts: number };

export interface GenerateOptions<TSchema extends z.ZodType> {
  brief: StructuredBrief;
  schema: TSchema;
  /** Injected by tests and by callers that already hold a provider. */
  provider?: AiProvider | undefined;
  maxOutputTokens?: number | undefined;
}

export const generateStructured = async <TSchema extends z.ZodType>(
  options: GenerateOptions<TSchema>,
): Promise<GenerationOutcome<z.output<TSchema>>> => {
  const provider = options.provider ?? getAiProvider();
  const messages: AiPromptMessage[] = [
    { role: 'system', content: options.brief.system },
    { role: 'user', content: options.brief.user },
  ];

  let lastMessage = 'The model produced nothing usable.';
  let lastIssues: string[] = [];

  for (let attempt = 1; attempt <= CONTENT_GENERATION_MAX_ATTEMPTS; attempt += 1) {
    let completion;

    try {
      completion = await provider.complete({
        messages,
        // No tools: this call has one job, and offering tools would let the
        // model answer with a tool request instead of the object we need.
        tools: [],
        ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
      });
    } catch (error) {
      // A provider outage is not a malformed reply and retrying the prompt will
      // not help, so it is surfaced as itself with the HTTP answer it deserves.
      if (isAiProviderError(error)) {
        throw error.toApiError();
      }

      throw error;
    }

    const parsed = parseStructured(completion.content, options.schema);

    if (parsed.ok) {
      return { ok: true, data: parsed.data, model: completion.model, attempts: attempt };
    }

    lastMessage = parsed.message;
    lastIssues = parsed.issues ?? [];

    log.warn(
      { attempt, reason: parsed.reason, issues: lastIssues.slice(0, 5) },
      'the model returned structured output that could not be used',
    );

    if (attempt < CONTENT_GENERATION_MAX_ATTEMPTS) {
      // The rejected reply and the reason both go back, so the retry is a
      // correction rather than the same roll of the dice.
      messages.push(
        { role: 'assistant', content: completion.content },
        { role: 'user', content: buildRepairInstruction(lastIssues) },
      );
    }
  }

  return {
    ok: false,
    message: lastMessage,
    issues: lastIssues,
    attempts: CONTENT_GENERATION_MAX_ATTEMPTS,
  };
};
