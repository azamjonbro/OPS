/**
 * What the transcription endpoint answers with.
 *
 * Deliberately small. The provider returns a great deal more — segment
 * timings, token log-probabilities, its own request identifiers — and none of
 * it is anything the composer needs. Passing the whole response through would
 * hand the browser provider-shaped data and make swapping the provider a
 * frontend change.
 */
export interface TranscriptionResult {
  /** The words, ready to be edited in the composer. */
  text: string;
  /** Length of the audio, when the provider reports it. */
  durationSeconds: number | null;
  /** ISO-639-1 code the provider detected, when it says. */
  language: string | null;
  /** Which model produced it, for support questions rather than for display. */
  model: string;
}

/** Whether voice input can be offered at all, and by what. */
export interface SpeechStatus {
  provider: string;
  available: boolean;
  model: string | null;
  reason: string | null;
  maxDurationSeconds: number;
  maxUploadBytes: number;
}
