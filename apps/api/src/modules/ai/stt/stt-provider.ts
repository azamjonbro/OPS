/**
 * The seam between "somebody spoke" and whichever model writes it down.
 *
 * The transcription service knows nothing about OpenAI, its form fields or its
 * response envelope: it hands over bytes and a content type and gets words back.
 * Everything vendor-shaped lives behind this, so changing model — or vendor — is
 * a configuration change rather than a code change.
 */
export interface TranscriptionRequest {
  audio: Buffer;
  /** The content type as received, already validated against the allow-list. */
  contentType: string;
  /** ISO-639-1 hint, or `null` to let the provider detect the language. */
  language?: string | null;
}

export interface TranscriptionOutcome {
  text: string;
  durationSeconds: number | null;
  language: string | null;
  model: string;
}

export interface SpeechProvider {
  readonly name: string;
  /** False when no credential is configured; transcription then refuses clearly. */
  readonly isConfigured: boolean;
  readonly model: string;
  transcribe: (request: TranscriptionRequest) => Promise<TranscriptionOutcome>;
}

let override: SpeechProvider | null = null;
let cached: SpeechProvider | null = null;

/** Testing seam: lets a suite supply a scripted provider. */
export const setSpeechProvider = (provider: SpeechProvider | null): void => {
  override = provider;
  cached = null;
};

export const getSpeechProviderOverride = (): SpeechProvider | null => override;

export const getCachedSpeechProvider = (): SpeechProvider | null => cached;

export const setCachedSpeechProvider = (provider: SpeechProvider | null): void => {
  cached = provider;
};
