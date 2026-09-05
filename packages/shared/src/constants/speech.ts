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
