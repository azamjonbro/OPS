import {
  SPEECH_DURATION_FIELD,
  SPEECH_UPLOAD_FIELD,
  type SpeechStatus,
  type TranscriptionResult,
} from '@hadiya/shared';

import { api, type RequestOptions } from './http';

export interface TranscribeOptions extends RequestOptions {
  /**
   * How long the recording ran, as the browser measured it.
   *
   * Sent so an over-long take can be refused before it is transcribed. The
   * server treats it as a claim rather than a fact — the size ceiling is what
   * actually bounds an upload — so omitting it costs correctness nothing.
   */
  durationMs?: number;
}

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
  transcribe: (audio: Blob, options: TranscribeOptions = {}): Promise<TranscriptionResult> => {
    const { durationMs, ...request } = options;
    const form = new FormData();

    // The filename is a formality — the server reads the content type and
    // ignores the name entirely — but a blob with no name is rejected by some
    // multipart parsers, so one is supplied.
    form.append(SPEECH_UPLOAD_FIELD, audio, 'recording');

    if (typeof durationMs === 'number' && Number.isFinite(durationMs)) {
      // Multipart carries strings; the server parses it back and ignores
      // anything it cannot read, so a rounded integer is the whole contract.
      form.append(SPEECH_DURATION_FIELD, String(Math.round(durationMs)));
    }

    return api.post<TranscriptionResult>('/v1/ai/transcribe', form, {
      timeout: TRANSCRIBE_TIMEOUT_MS,
      ...request,
      // Left to the browser: it has to set the multipart boundary, and naming
      // the type here without one produces a body no parser can read.
      headers: { ...request.headers },
    });
  },

  status: (options: RequestOptions = {}): Promise<SpeechStatus> =>
    api.get<SpeechStatus>('/v1/ai/speech-status', options),
};
