import { SPEECH_MAX_DURATION_SECONDS, SPEECH_MIN_UPLOAD_BYTES } from '@hadiya/shared';
import { computed, onBeforeUnmount, readonly, ref, type ComputedRef, type Ref } from 'vue';

/**
 * Capturing audio from the microphone, and nothing else.
 *
 * This composable knows about `MediaRecorder` and knows nothing about Hadiya:
 * it does not upload, does not transcribe and has never heard of the composer.
 * That separation is what lets the recording behaviour be reasoned about — and
 * tested — without a server, and what keeps provider concerns out of a Vue
 * component.
 *
 * The microphone track is released on every exit path, including cancel,
 * unmount and error. A forgotten track leaves the browser's recording indicator
 * lit, which is alarming and entirely our fault when it happens.
 */
export type RecorderState = 'idle' | 'requesting' | 'recording' | 'stopping';

export type RecorderErrorKind =
  | 'unsupported'
  | 'permission-denied'
  | 'no-microphone'
  | 'empty'
  | 'failed';

export interface RecorderError {
  kind: RecorderErrorKind;
  message: string;
}

/**
 * Formats a browser might record, best first.
 *
 * Asked rather than assumed: Chromium and Firefox produce WebM/Opus and Safari
 * produces MP4/AAC, so hard-coding either would silently remove the feature
 * from half the devices a shop actually uses.
 */
const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/mpeg',
];

export const pickMimeType = (
  isSupported: (type: string) => boolean = (type) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type),
): string | null => PREFERRED_MIME_TYPES.find((type) => isSupported(type)) ?? null;

const isRecordingSupported = (): boolean =>
  typeof MediaRecorder !== 'undefined' &&
  typeof navigator !== 'undefined' &&
  typeof navigator.mediaDevices?.getUserMedia === 'function';

/** Browser errors are named, not typed; the name is what distinguishes them. */
const toRecorderError = (error: unknown): RecorderError => {
  const name = error instanceof Error ? error.name : '';

  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return {
      kind: 'permission-denied',
      message: 'Microphone permission is required. Allow it in your browser and try again.',
    };
  }

  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return { kind: 'no-microphone', message: 'No microphone was found on this device.' };
  }

  if (name === 'NotReadableError') {
    return {
      kind: 'no-microphone',
      message: 'The microphone is being used by something else.',
    };
  }

  return { kind: 'failed', message: 'Recording could not be started. Please try again.' };
};

export interface VoiceRecorder {
  state: Readonly<Ref<RecorderState>>;
  /** Seconds captured so far. */
  elapsedSeconds: Readonly<Ref<number>>;
  error: Readonly<Ref<RecorderError | null>>;
  isRecording: ComputedRef<boolean>;
  isBusy: ComputedRef<boolean>;
  /** False where the browser cannot record at all; the button then explains why. */
  isSupported: ComputedRef<boolean>;
  /** How long is left before the recorder stops itself. */
  remainingSeconds: ComputedRef<number>;
  start: () => Promise<void>;
  /** Resolves with the recording, or `null` when there was nothing usable. */
  stop: () => Promise<Blob | null>;
  /** Throws the recording away without producing anything. */
  cancel: () => void;
}

export interface VoiceRecorderOptions {
  maxDurationSeconds?: number;
  /** Called when the ceiling stopped the recording rather than the person. */
  onLimitReached?: () => void;
}

export const useVoiceRecorder = (options: VoiceRecorderOptions = {}): VoiceRecorder => {
  const maxDuration = options.maxDurationSeconds ?? SPEECH_MAX_DURATION_SECONDS;

  const state = ref<RecorderState>('idle');
  const elapsedSeconds = ref(0);
  const error = ref<RecorderError | null>(null);

  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: Blob[] = [];
  let ticker: ReturnType<typeof setInterval> | null = null;
  /** Set while cancelling, so the `stop` handler knows to discard. */
  let discarding = false;

  const isRecording = computed(() => state.value === 'recording');
  const isBusy = computed(() => state.value !== 'idle');
  const isSupported = computed(() => isRecordingSupported());
  const remainingSeconds = computed(() => Math.max(0, maxDuration - elapsedSeconds.value));

  /**
   * Releases the microphone.
   *
   * Called from every exit path. Stopping the tracks is what turns the
   * browser's recording indicator off; leaving them open is the single most
   * visible way a voice feature can feel untrustworthy.
   */
  const release = (): void => {
    if (ticker) {
      clearInterval(ticker);
      ticker = null;
    }

    for (const track of stream?.getTracks() ?? []) {
      track.stop();
    }

    stream = null;
    recorder = null;
  };

  const start = async (): Promise<void> => {
    if (state.value !== 'idle') {
      return;
    }

    error.value = null;

    if (!isRecordingSupported()) {
      error.value = {
        kind: 'unsupported',
        message: 'This browser cannot record audio. Try Chrome, Edge, Firefox or Safari.',
      };

      return;
    }

    const mimeType = pickMimeType();

    if (!mimeType) {
      error.value = {
        kind: 'unsupported',
        message: 'This browser has no audio format Hadiya can transcribe.',
      };

      return;
    }

    state.value = 'requesting';

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // Modest processing: dictation on a shop floor is noisy, and these are
        // the three the platform gives away for free.
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (caught) {
      error.value = toRecorderError(caught);
      state.value = 'idle';
      release();

      return;
    }

    chunks = [];
    discarding = false;

    try {
      recorder = new MediaRecorder(stream, { mimeType });
    } catch {
      error.value = { kind: 'failed', message: 'Recording could not be started on this device.' };
      state.value = 'idle';
      release();

      return;
    }

    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    });

    recorder.start();
    state.value = 'recording';
    elapsedSeconds.value = 0;

    ticker = setInterval(() => {
      elapsedSeconds.value += 1;

      if (elapsedSeconds.value >= maxDuration) {
        // The ceiling stops the recording; it does not throw it away. What was
        // said still gets transcribed, which is the difference between a limit
        // and a punishment.
        options.onLimitReached?.();
        void stop();
      }
    }, 1_000);
  };

  const stop = (): Promise<Blob | null> => {
    const active = recorder;

    if (!active || state.value !== 'recording') {
      return Promise.resolve(null);
    }

    state.value = 'stopping';

    return new Promise<Blob | null>((resolve) => {
      active.addEventListener(
        'stop',
        () => {
          const type = active.mimeType || chunks[0]?.type || 'audio/webm';
          const blob = new Blob(chunks, { type });

          chunks = [];
          release();
          state.value = 'idle';
          elapsedSeconds.value = 0;

          if (discarding) {
            discarding = false;
            resolve(null);

            return;
          }

          if (blob.size < SPEECH_MIN_UPLOAD_BYTES) {
            error.value = {
              kind: 'empty',
              message: 'That recording was too short. Hold the button and speak a little longer.',
            };
            resolve(null);

            return;
          }

          resolve(blob);
        },
        { once: true },
      );

      active.stop();
    });
  };

  const cancel = (): void => {
    if (state.value === 'idle') {
      return;
    }

    discarding = true;
    error.value = null;

    if (recorder && state.value === 'recording') {
      // The `stop` handler sees `discarding` and resolves with nothing, so no
      // upload is started and the composer is never touched.
      void stop();

      return;
    }

    chunks = [];
    release();
    state.value = 'idle';
    elapsedSeconds.value = 0;
  };

  // Navigating away mid-recording must not leave the microphone open.
  onBeforeUnmount(() => {
    discarding = true;
    chunks = [];

    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }

    release();
  });

  return {
    state: readonly(state),
    elapsedSeconds: readonly(elapsedSeconds),
    error: readonly(error) as Readonly<Ref<RecorderError | null>>,
    isRecording,
    isBusy,
    isSupported,
    remainingSeconds,
    start,
    stop,
    cancel,
  };
};
