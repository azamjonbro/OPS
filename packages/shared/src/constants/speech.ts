/**
 * What the transcription endpoint will accept.
 *
 * The list is what browsers actually produce plus the handful of container
 * formats somebody might upload. `MediaRecorder` emits WebM/Opus on Chromium
 * and Firefox and MP4/AAC on Safari, so both have to be here or the feature
 * simply does not exist on one of them.
 *
 * A browser sends the codec as a parameter — `audio/webm;codecs=opus` — so the
 * comparison is always against the type without its parameters.
 */
export const SPEECH_AUDIO_MIME_TYPES = [
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/m4a',
  'audio/x-m4a',
  'audio/flac',
] as const;

export type SpeechAudioMimeType = (typeof SPEECH_AUDIO_MIME_TYPES)[number];

/** `audio/webm;codecs=opus` becomes `audio/webm`. */
export const normaliseAudioMimeType = (value: string): string =>
  value.split(';')[0]?.trim().toLowerCase() ?? '';

export const isSupportedAudioMimeType = (value: string): boolean =>
  (SPEECH_AUDIO_MIME_TYPES as readonly string[]).includes(normaliseAudioMimeType(value));

/**
 * Upload ceiling, matching what the provider itself accepts.
 *
 * Rejecting at the edge means a file that could never be transcribed is not
 * carried across the network twice to find that out.
 */
export const SPEECH_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Below this there is no speech in the file — a click, or a recorder that was
 * stopped before it captured anything. Failing here gives a better message than
 * a provider returning an empty string.
 */
export const SPEECH_MIN_UPLOAD_BYTES = 512;

/**
 * How long one recording may run.
 *
 * Five minutes is far more than a spoken instruction and still well inside the
 * size ceiling at Opus bitrates. The recorder stops itself at the limit and
 * transcribes what it has, rather than discarding the whole take.
 */
export const SPEECH_MAX_DURATION_SECONDS = 300;

/** Warn the speaker with this long left, so the cut is not a surprise. */
export const SPEECH_DURATION_WARNING_SECONDS = 30;

/** The transcript goes into the composer, so it shares the composer's ceiling. */
export const SPEECH_TRANSCRIPT_MAX_LENGTH = 8_000;

/**
 * The form field the audio arrives on. Named once here so the browser and the
 * server cannot disagree about it.
 */
export const SPEECH_UPLOAD_FIELD = 'audio';

/**
 * What one account may spend on dictation.
 *
 * Transcription is billed per second of audio, and the microphone is the one
 * control in the interface that a pocket can press. So this is a cost ceiling
 * before it is an abuse ceiling: twenty recordings a minute is far more than
 * anybody dictating a question will use, and far less than a phone face-down on
 * a counter could run up.
 *
 * Keyed by account rather than by address, because a shop's staff share one
 * connection and one person's stuck button must not silence everybody else's
 * microphone.
 */
export const SPEECH_RATE_LIMIT = {
  windowMs: 60_000,
  /** Recordings per account per minute. */
  max: 20,
} as const;

/**
 * Longest recording the browser is allowed to declare.
 *
 * Checked before the audio is sent anywhere, so an over-long take is refused
 * without being paid for. It is a *declared* figure and therefore not a
 * security control — the size ceiling is what actually bounds an upload — but
 * it turns "your recording was too long" into an answer that arrives in
 * milliseconds rather than after a minute of transcription.
 */
export const SPEECH_MAX_DECLARED_DURATION_MS = SPEECH_MAX_DURATION_SECONDS * 1_000 + 5_000;

/** The form field a client declares the recording's length on. */
export const SPEECH_DURATION_FIELD = 'durationMs';

/**
 * The languages this shop actually speaks.
 *
 * Whisper detects the language itself, and for Uzbek it is not reliable: the
 * model was trained on far less Uzbek than Russian or Kazakh, and a short
 * Uzbek phrase is regularly heard as one of its Cyrillic neighbours. What comes
 * back is then not a bad transcript but a different language altogether —
 * plausible-looking Cyrillic that the speaker did not say.
 *
 * So detection is allowed to run, and its answer is checked against this list.
 * Anything outside it is treated as a misdetection and the audio is offered
 * once more with the primary language pinned. The first entry is that primary.
 *
 * Kept as a list rather than a single pinned language because the two are
 * genuinely both used, and forcing one would mangle the other.
 */
export const SPEECH_LANGUAGES = ['uz', 'en'] as const;

export type SpeechLanguage = (typeof SPEECH_LANGUAGES)[number];

/**
 * Whisper does not agree with itself about how to name a language.
 *
 * Depending on the endpoint and the response format it answers `uz`, `uz-UZ`
 * or `Uzbek`. All three mean the same thing and all three have to reduce to
 * the same code, or the check below fires on every request and re-transcribes
 * audio that was understood perfectly the first time.
 *
 * Only the languages plausibly heard around this shop are named. Anything
 * unrecognised keeps its own lowercased text, which will not match the
 * allow-list — the safe direction, because an unfamiliar answer is exactly the
 * case worth looking at again.
 */
const LANGUAGE_NAMES: Record<string, string> = {
  uzbek: 'uz',
  english: 'en',
  russian: 'ru',
  kazakh: 'kk',
  kyrgyz: 'ky',
  tajik: 'tg',
  turkmen: 'tk',
  turkish: 'tr',
  azerbaijani: 'az',
  karakalpak: 'kaa',
  arabic: 'ar',
  persian: 'fa',
  tatar: 'tt',
};

/** `uz-UZ`, `UZ`, `uz` and `Uzbek` are the same answer. */
export const normaliseLanguage = (value: string | null | undefined): string | null => {
  const raw = value?.trim().toLowerCase() ?? '';

  if (raw.length === 0) {
    return null;
  }

  const named = LANGUAGE_NAMES[raw];

  if (named) {
    return named;
  }

  // A code, possibly with a region: `uz-UZ` is `uz`. Names are not truncated
  // to two letters — "kazakh" would become "ka", which is Georgian, and the
  // whole point of this is to notice Kazakh rather than wave it through.
  const code = raw.split(/[-_]/)[0] ?? '';

  return code.length >= 2 && code.length <= 3 ? code : raw;
};

export const isExpectedLanguage = (
  value: string | null | undefined,
  allowed: readonly string[] = SPEECH_LANGUAGES,
): boolean => {
  const code = normaliseLanguage(value);

  return code === null || allowed.includes(code);
};
