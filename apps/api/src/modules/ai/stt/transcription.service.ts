import {
  isSupportedAudioMimeType,
  normaliseAudioMimeType,
  SPEECH_MAX_UPLOAD_BYTES,
  SPEECH_MIN_UPLOAD_BYTES,
  type AuthenticatedUser,
  type TranscriptionResult,
} from '@hadiya/shared';

import { ApiError } from '../../../core/http/api-error.js';
import { createLogger } from '../../../core/logger/logger.js';
import { isAiProviderError } from '../provider/index.js';
import { getSpeechProvider } from './index.js';
import type { SpeechProvider } from './stt-provider.js';

const log = createLogger('speech');

/**
 * Turning a recording into words.
 *
 * The audio never touches disk and is never stored: it arrives as a buffer,
 * goes to the provider, and is released when the request ends. Nothing about a
 * person's voice is worth keeping to satisfy a feature whose entire output is a
 * line of editable text.
 *
 * The validation below repeats what the upload middleware already enforces, and
 * deliberately so — the middleware protects the *server* from a large or wrong
 * upload, and this protects the *provider* from being paid to listen to
 * silence. A caller reaching this service another way gets the same rules.
 */
export interface TranscribeInput {
  audio: Buffer;
  mimeType: string;
  /** ISO-639-1 hint. Absent means let the provider detect the language. */
  language?: string | null;
}

export interface TranscriptionDependencies {
  provider?: SpeechProvider | undefined;
}

/** Turns a provider failure into the one error shape the client handles. */
const transcriptionFailed = (error: unknown): ApiError => {
  if (error instanceof ApiError) {
    return error;
  }

  if (isAiProviderError(error)) {
    // The message is ours, written for a person; nothing from the upstream body
    // reaches it, because a provider can echo request material back inside one.
    if (error.kind === 'rate_limited') {
      return ApiError.rateLimited('Voice input is busy right now. Try again in a moment.', {
        cause: error,
        details: { integration: 'speech', kind: error.kind },
      });
    }

    if (error.kind === 'timeout') {
      return ApiError.dependencyUnavailable(
        'That recording took too long to transcribe. Try a shorter one.',
        { cause: error, details: { integration: 'speech', kind: error.kind } },
      );
    }

    return ApiError.dependencyUnavailable(
      'Voice transcription failed. Please try again.',
      { cause: error, details: { integration: 'speech', kind: error.kind } },
    );
  }

  return ApiError.dependencyUnavailable('Voice transcription failed. Please try again.', {
    cause: error,
  });
};

export const transcribe = async (
  actor: AuthenticatedUser,
  input: TranscribeInput,
  dependencies: TranscriptionDependencies = {},
): Promise<TranscriptionResult> => {
  const provider = dependencies.provider ?? getSpeechProvider();
  const contentType = normaliseAudioMimeType(input.mimeType);

  if (!isSupportedAudioMimeType(contentType)) {
    throw ApiError.badRequest(`"${input.mimeType}" is not an audio format this server accepts.`);
  }

  if (input.audio.byteLength > SPEECH_MAX_UPLOAD_BYTES) {
    throw ApiError.badRequest('That recording is too large.');
  }

  if (input.audio.byteLength < SPEECH_MIN_UPLOAD_BYTES) {
    // Almost always a recorder stopped before it captured anything; paying a
    // provider to confirm that would be silly.
    throw ApiError.badRequest('That recording is too short to make out.');
  }

  if (!provider.isConfigured) {
    // The provider raises its own refusal, so the reason is the provider's
    // rather than a guess made here.
    await provider.transcribe({ audio: input.audio, contentType });

    throw ApiError.dependencyUnavailable('Voice input is not available.');
  }

  const startedAt = Date.now();

  try {
    const outcome = await provider.transcribe({
      audio: input.audio,
      contentType,
      language: input.language ?? null,
    });

    if (outcome.text.length === 0) {
      // The provider heard nothing. Reported as a plain failure rather than an
      // empty success, which would silently clear the composer.
      throw ApiError.badRequest('I could not make out any speech in that recording.');
    }

    log.info(
      {
        userId: actor.id,
        model: outcome.model,
        bytes: input.audio.byteLength,
        // The transcript itself is never logged: it is the person's words, and
        // a log is the wrong place for them.
        characters: outcome.text.length,
        durationMs: Date.now() - startedAt,
      },
      'audio transcribed',
    );

    return {
      text: outcome.text,
      durationSeconds: outcome.durationSeconds,
      language: outcome.language,
      model: outcome.model,
    };
  } catch (error) {
    throw transcriptionFailed(error);
  }
};
