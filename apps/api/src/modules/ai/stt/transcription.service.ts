import {
  isExpectedLanguage,
  isSupportedAudioMimeType,
  normaliseAudioMimeType,
  normaliseLanguage,
  SPEECH_LANGUAGES,
  SPEECH_MAX_DECLARED_DURATION_MS,
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
  /**
   * How long the browser says the recording is.
   *
   * A courtesy, not a control: it comes from the client and could say anything,
   * which is why the size ceiling is what actually bounds an upload. What it
   * buys is a refusal that arrives in milliseconds instead of after a minute of
   * transcription somebody has already been billed for.
   */
  declaredDurationMs?: number | null;
  /** Correlates the log line with the HTTP request that caused it. */
  requestId?: string | undefined;
  /**
   * The languages this deployment expects to hear, primary first.
   *
   * A detected language outside the list is treated as a misdetection rather
   * than as an answer. Defaults to `SPEECH_LANGUAGES`.
   */
  languages?: readonly string[] | undefined;
}

export interface TranscriptionDependencies {
  provider?: SpeechProvider | undefined;
}

/**
 * What kind of failure it was, in one word, for a log line.
 *
 * Enough to answer "is dictation broken, and whose fault is it" from a
 * dashboard without reading a single transcript or upstream body.
 */
const failureCategory = (error: unknown): string => {
  if (isAiProviderError(error)) {
    return error.kind;
  }

  if (error instanceof ApiError) {
    return error.code;
  }

  return 'unknown';
};

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

    if (error.kind === 'quota_exhausted') {
      // Deliberately not "try again shortly": the balance is empty, so trying
      // again tomorrow fails identically. Somebody has to top the account up,
      // and saying so is the only thing that gets dictation working.
      return ApiError.dependencyUnavailable(
        'Voice input is unavailable: the AI account has run out of credit.',
        { cause: error, details: { integration: 'speech', kind: error.kind } },
      );
    }

    if (error.kind === 'timeout') {
      return ApiError.dependencyUnavailable(
        'That recording took too long to transcribe. Try a shorter one.',
        { cause: error, details: { integration: 'speech', kind: error.kind } },
      );
    }

    return ApiError.dependencyUnavailable('Voice transcription failed. Please try again.', {
      cause: error,
      details: { integration: 'speech', kind: error.kind },
    });
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

  if (
    typeof input.declaredDurationMs === 'number' &&
    input.declaredDurationMs > SPEECH_MAX_DECLARED_DURATION_MS
  ) {
    throw ApiError.badRequest('That recording is longer than voice input accepts.');
  }

  if (!provider.isConfigured) {
    // The provider raises its own refusal, so the reason is the provider's
    // rather than a guess made here.
    await provider.transcribe({ audio: input.audio, contentType });

    throw ApiError.dependencyUnavailable('Voice input is not available.');
  }

  const startedAt = Date.now();
  const expected = input.languages ?? SPEECH_LANGUAGES;

  try {
    let outcome = await provider.transcribe({
      audio: input.audio,
      contentType,
      language: input.language ?? null,
    });
    let correctedFrom: string | null = null;

    /**
     * The model heard a language nobody here speaks.
     *
     * Whisper detects the language itself, and for Uzbek it is not reliable —
     * a short phrase is regularly heard as Kazakh or Russian, and what comes
     * back is then not a rough transcript but confident Cyrillic the speaker
     * never said. Which is worse than a bad transcript: it looks like a real
     * sentence, so nobody corrects it.
     *
     * The audio is offered once more with the primary language pinned. Once,
     * and only when detection strayed outside the languages this shop speaks —
     * a second call costs real time and money, and pinning by default would
     * mangle the other language rather than the one it fixed.
     */
    if (!input.language && !isExpectedLanguage(outcome.language, expected)) {
      correctedFrom = normaliseLanguage(outcome.language);

      outcome = await provider.transcribe({
        audio: input.audio,
        contentType,
        language: expected[0] ?? 'uz',
      });
    }

    // Trimmed here as well as in the provider: whitespace-only is "heard
    // nothing" whichever implementation is installed, and a contract that
    // relies on every provider remembering to trim will eventually meet one
    // that did not.
    const text = outcome.text.trim();

    if (text.length === 0) {
      // The provider heard nothing. Reported as a plain failure rather than an
      // empty success, which would silently clear the composer.
      throw ApiError.badRequest('I could not make out any speech in that recording.');
    }

    log.info(
      {
        requestId: input.requestId,
        userId: actor.id,
        provider: provider.name,
        model: outcome.model,
        bytes: input.audio.byteLength,
        contentType,
        audioSeconds: outcome.durationSeconds,
        language: outcome.language,
        // Present only when detection had to be overruled, so the frequency of
        // that is visible without reading a single transcript.
        ...(correctedFrom ? { correctedFrom } : {}),
        // The transcript itself is never logged: it is the person's words, and
        // a log is the wrong place for them. Its length is not.
        characters: text.length,
        latencyMs: Date.now() - startedAt,
        outcome: 'succeeded',
      },
      'audio transcribed',
    );

    return {
      text,
      durationSeconds: outcome.durationSeconds,
      language: outcome.language,
      model: outcome.model,
    };
  } catch (error) {
    log.warn(
      {
        requestId: input.requestId,
        userId: actor.id,
        provider: provider.name,
        bytes: input.audio.byteLength,
        contentType,
        latencyMs: Date.now() - startedAt,
        outcome: 'failed',
        category: failureCategory(error),
      },
      'transcription failed',
    );

    throw transcriptionFailed(error);
  }
};
