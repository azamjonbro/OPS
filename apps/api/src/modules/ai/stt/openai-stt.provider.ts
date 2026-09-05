import { SPEECH_TRANSCRIPT_MAX_LENGTH } from '@hadiya/shared';
import type { Logger } from 'pino';

import { createLogger } from '../../../core/logger/logger.js';
import { AiProviderError } from '../provider/ai-error.js';
import type { FetchLike } from '../provider/ai-http.js';
import type {
  SpeechProvider,
  TranscriptionOutcome,
  TranscriptionRequest,
} from './stt-provider.js';

/** OpenAI's transcription response, only as far as this provider uses it. */
interface OpenAiTranscription {
  text?: string;
  duration?: number;
  language?: string;
  model?: string;
}

export interface OpenAiSpeechProviderOptions {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  /** `null` lets the model detect the language, which is the default. */
  language?: string | null;
  fetchImpl?: FetchLike;
  logger?: Logger;
  sleep?: (ms: number) => Promise<void>;
}

/** Extensions the API recognises; it reads the format from the filename. */
const EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'mp4',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
};

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_PAYLOAD_TOO_LARGE = 413;
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
/** Enough of an error body to diagnose from; short enough not to be a payload. */
const LOGGED_BODY_LIMIT = 300;

const classify = (status: number): AiProviderError => {
  if (status === HTTP_UNAUTHORIZED || status === HTTP_FORBIDDEN) {
    return new AiProviderError('invalid_credentials', 'the configured API key was rejected', {
      status,
    });
  }

  if (status === HTTP_NOT_FOUND) {
    return new AiProviderError('model_unavailable', 'the transcription model is not available', {
      status,
    });
  }

  if (status === HTTP_TOO_MANY_REQUESTS) {
    return new AiProviderError('rate_limited', 'the provider is rate limiting this key', {
      status,
    });
  }

  if (status === HTTP_PAYLOAD_TOO_LARGE) {
    return new AiProviderError('upstream_error', 'the recording was too large for the provider', {
      status,
    });
  }

  return new AiProviderError('upstream_error', `the provider answered ${status}`, { status });
};

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * OpenAI's transcription models, behind the `SpeechProvider` interface.
 *
 * The audio is posted as multipart, which is why this does not reuse the JSON
 * helper the chat providers share: the body is a `FormData` and the platform
 * sets the boundary. The credential lives only in the header and is never
 * logged; error bodies are logged truncated and never reach the caller's
 * message, because an upstream body can echo request material back.
 *
 * No language is sent unless one is configured. Detection is what a bilingual
 * shop floor needs — somebody switching between Uzbek and Russian mid-shift
 * should not have to tell the interface which they are about to use.
 */
export class OpenAiSpeechProvider implements SpeechProvider {
  readonly name = 'openai';
  readonly isConfigured = true;

  private readonly log: Logger;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: OpenAiSpeechProviderOptions) {
    this.log = options.logger ?? createLogger('stt-openai');
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.sleep = options.sleep ?? defaultSleep;
  }

  get model(): string {
    return this.options.model;
  }

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionOutcome> {
    const extension = EXTENSIONS[request.contentType] ?? 'webm';
    const url = `${this.options.baseUrl.replace(/\/$/, '')}/audio/transcriptions`;
    let lastError: AiProviderError | null = null;

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
      if (attempt > 0) {
        await this.sleep(Math.min(500 * 2 ** (attempt - 1), 4_000));
      }

      const body = new FormData();

      // The filename is this server's, never the client's: the API reads the
      // container format from the extension, and a name from the browser is
      // untrusted text with no business influencing that.
      body.append(
        'file',
        new Blob([new Uint8Array(request.audio)], { type: request.contentType }),
        `recording.${extension}`,
      );
      body.append('model', this.options.model);
      // `json` keeps the reply small; the verbose form carries per-segment
      // timings this product has no use for.
      body.append('response_format', 'json');

      const language = request.language ?? this.options.language;

      if (language) {
        body.append('language', language);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
      const startedAt = Date.now();

      try {
        const response = await this.fetchImpl(url, {
          method: 'POST',
          headers: { authorization: `Bearer ${this.options.apiKey}` },
          body,
          signal: controller.signal,
        });

        const text = await response.text();

        this.log.debug(
          { status: response.status, durationMs: Date.now() - startedAt, model: this.model },
          'transcription request completed',
        );

        if (!response.ok) {
          const error = classify(response.status);

          this.log.warn(
            { status: response.status, body: text.slice(0, LOGGED_BODY_LIMIT) },
            'transcription request failed',
          );

          if (!RETRYABLE.has(response.status) || attempt === this.options.maxRetries) {
            throw error;
          }

          lastError = error;
          continue;
        }

        let parsed: OpenAiTranscription;

        try {
          parsed = JSON.parse(text) as OpenAiTranscription;
        } catch (error) {
          throw new AiProviderError(
            'malformed_response',
            'the provider returned a response that is not JSON',
            { status: response.status, cause: error },
          );
        }

        if (typeof parsed.text !== 'string') {
          throw new AiProviderError(
            'malformed_response',
            'the provider returned no transcript',
            { status: response.status },
          );
        }

        return {
          // Trimmed and bounded: the transcript goes straight into a composer
          // whose own limit is the same, so a runaway reply cannot make the
          // field unusable.
          text: parsed.text.trim().slice(0, SPEECH_TRANSCRIPT_MAX_LENGTH),
          durationSeconds: typeof parsed.duration === 'number' ? parsed.duration : null,
          language: typeof parsed.language === 'string' ? parsed.language : null,
          model: parsed.model ?? this.options.model,
        };
      } catch (error) {
        if (error instanceof AiProviderError) {
          if (!error.isRetryable || attempt === this.options.maxRetries) {
            throw error;
          }

          lastError = error;
          continue;
        }

        const wrapped =
          error instanceof Error && error.name === 'AbortError'
            ? new AiProviderError(
                'timeout',
                `the provider did not answer within ${this.options.timeoutMs}ms`,
                { cause: error },
              )
            : new AiProviderError('network', 'the provider could not be reached', {
                cause: error,
              });

        if (attempt === this.options.maxRetries) {
          throw wrapped;
        }

        lastError = wrapped;
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError ?? new AiProviderError('upstream_error', 'the transcription request failed');
  }
}
