import {
  SPEECH_MAX_DURATION_SECONDS,
  SPEECH_MAX_UPLOAD_BYTES,
  type SpeechStatus,
} from '@hadiya/shared';

import { config } from '../../../config/index.js';
import { ApiError } from '../../../core/http/api-error.js';
import { OpenAiSpeechProvider } from './openai-stt.provider.js';
import {
  getCachedSpeechProvider,
  getSpeechProviderOverride,
  setCachedSpeechProvider,
  type SpeechProvider,
} from './stt-provider.js';

/** Transcription lives under the same host as the chat models. */
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/**
 * Stands in when no transcription model is configured.
 *
 * It refuses clearly rather than returning an empty transcript, which would
 * look to the speaker like the microphone had failed to hear them.
 */
export const createUnconfiguredSpeechProvider = (reason: string): SpeechProvider => ({
  name: 'unconfigured',
  isConfigured: false,
  model: 'none',
  transcribe: () => {
    throw ApiError.dependencyUnavailable(`Voice input is not available: ${reason}`, {
      details: { integration: 'speech', kind: 'not_configured' },
    });
  },
});

const build = (): SpeechProvider => {
  // Transcription uses its own credential when one is set and the chat key
  // otherwise, so configuring the assistant configures dictation too — while
  // still allowing the two halves to point at different services, which is
  // what running both on free tiers actually requires.
  if (!config.speech.configured) {
    return createUnconfiguredSpeechProvider('set OPENAI_API_KEY or STT_API_KEY');
  }

  if (config.speech.provider !== null && config.speech.provider !== 'openai') {
    return createUnconfiguredSpeechProvider(
      `STT_PROVIDER is set to ${String(config.speech.provider)}, which is not implemented`,
    );
  }

  return new OpenAiSpeechProvider({
    apiKey: config.speech.apiKey ?? '',
    model: config.speech.model,
    baseUrl: config.speech.baseUrl ?? DEFAULT_BASE_URL,
    timeoutMs: config.speech.timeoutMs,
    maxRetries: config.speech.maxRetries,
    language: config.speech.language,
  });
};

/** Built once, because a provider holds only configuration and a `fetch`. */
export const getSpeechProvider = (): SpeechProvider => {
  const override = getSpeechProviderOverride();

  if (override) {
    return override;
  }

  const cached = getCachedSpeechProvider();

  if (cached) {
    return cached;
  }

  const provider = build();
  setCachedSpeechProvider(provider);

  return provider;
};

/** What the composer asks before offering a microphone. Holds no credential. */
export const describeSpeechProvider = (): SpeechStatus => {
  const provider = getSpeechProvider();

  return {
    provider: provider.name,
    available: provider.isConfigured,
    model: provider.isConfigured ? provider.model : null,
    reason: provider.isConfigured ? null : 'no transcription model is configured',
    maxDurationSeconds: SPEECH_MAX_DURATION_SECONDS,
    maxUploadBytes: SPEECH_MAX_UPLOAD_BYTES,
  };
};

export { OpenAiSpeechProvider } from './openai-stt.provider.js';
export {
  setSpeechProvider,
  type SpeechProvider,
  type TranscriptionOutcome,
  type TranscriptionRequest,
} from './stt-provider.js';
