import { SPEECH_UPLOAD_FIELD, type SpeechStatus, type TranscriptionResult } from '@hadiya/shared';

import { api, type RequestOptions } from './http';

/**
 * Dictation, through the same client as everything else.
 *
 * The recording is uploaded as multipart and the answer is a line of text. No
 * component builds a `FormData` or knows the field name — that lives here, next
 * to the one constant the server reads it from, so the two cannot drift apart.
 *
 * Transcription is slower than an ordinary request and much slower than a
 * click, so it gets its own timeout: the default would abandon a perfectly good
 * recording halfway through being listened to.
 */
const TRANSCRIBE_TIMEOUT_MS = 120_000;

export const speechService = {
  /**
   * Sends one recording and returns what was said.
   *
   * `signal` is threaded through so a caller can walk away from an answer it no
   * longer wants — the request is cancelled rather than merely ignored.
   */
  transcribe: (audio: Blob, options: RequestOptions = {}): Promise<TranscriptionResult> => {
    const form = new FormData();

    // The filename is a formality — the server reads the content type and
    // ignores the name entirely — but a blob with no name is rejected by some
    // multipart parsers, so one is supplied.
    form.append(SPEECH_UPLOAD_FIELD, audio, 'recording');

    return api.post<TranscriptionResult>('/v1/ai/transcribe', form, {
      timeout: TRANSCRIBE_TIMEOUT_MS,
      ...options,
      // Left to the browser: it has to set the multipart boundary, and naming
      // the type here without one produces a body no parser can read.
      headers: { ...options.headers },
    });
  },

  status: (options: RequestOptions = {}): Promise<SpeechStatus> =>
    api.get<SpeechStatus>('/v1/ai/speech-status', options),
};
