import { SPEECH_DURATION_WARNING_SECONDS, SPEECH_MAX_DURATION_SECONDS } from '@hadiya/shared';
import { computed, ref, type ComputedRef, type Ref } from 'vue';

import { isCancelled, toErrorMessage } from '@/services/api-error';
import { speechService } from '@/services/speech.service';
import { useVoiceRecorder, type RecorderError } from './useVoiceRecorder';

/**
 * Recording, uploading and transcribing — as one thing the composer can drive.
 *
 * The recorder handles the microphone and the service handles the network; this
 * sequences them and owns the one piece of state neither can: which request is
 * still wanted. That matters because transcription is slow enough for a person
 * to change their mind, and a result that arrives after they have started
 * typing must never overwrite what they wrote.
 *
 * It deliberately does not send anything. The transcript is handed back to the
 * caller, which puts it in the composer for review — wiring this to the
 * assistant would turn a misheard word into a message nobody chose to send.
 */
export type VoiceInputPhase =
  | 'idle'
  | 'requesting'
  | 'recording'
  | 'uploading'
  | 'transcribing'
  | 'error';

export interface VoiceInput {
  phase: ComputedRef<VoiceInputPhase>;
  elapsedSeconds: Readonly<Ref<number>>;
  remainingSeconds: ComputedRef<number>;
  /** True in the last stretch, so the speaker can be warned before the cut. */
  isNearLimit: ComputedRef<boolean>;
  error: ComputedRef<string | null>;
  isSupported: ComputedRef<boolean>;
  isActive: ComputedRef<boolean>;
  /** Starts, or stops and transcribes — one control, as the button is one button. */
  toggle: () => Promise<void>;
  cancel: () => void;
  dismissError: () => void;
}

export interface VoiceInputOptions {
  /**
   * Receives the transcript. Called only when the request is still the current
   * one, so a superseded result is dropped rather than applied.
   */
  onTranscript: (text: string) => void;
  maxDurationSeconds?: number;
}

export const useVoiceInput = (options: VoiceInputOptions): VoiceInput => {
  const maxDuration = options.maxDurationSeconds ?? SPEECH_MAX_DURATION_SECONDS;

  const networkPhase = ref<'idle' | 'uploading' | 'transcribing'>('idle');
  const networkError = ref<string | null>(null);

  /**
   * Which transcription is wanted.
   *
   * Bumped whenever a new recording starts or the person cancels. A reply whose
   * id no longer matches is discarded — that is the protection against a slow
   * transcription landing on top of a newer one, or on top of a recording the
   * person abandoned.
   */
  let requestId = 0;
  let controller: AbortController | null = null;

  const recorder = useVoiceRecorder({
    maxDurationSeconds: maxDuration,
    onLimitReached: () => {
      networkError.value = `Recordings stop at ${Math.round(maxDuration / 60)} minutes. Transcribing what you said.`;
    },
  });

  const phase = computed<VoiceInputPhase>(() => {
    if (networkPhase.value !== 'idle') {
      return networkPhase.value;
    }

    if (recorder.state.value === 'requesting') {
      return 'requesting';
    }

    if (recorder.state.value === 'recording' || recorder.state.value === 'stopping') {
      return 'recording';
    }

    return recorder.error.value || networkError.value ? 'error' : 'idle';
  });

  const error = computed<string | null>(() => {
    const recorderError: RecorderError | null = recorder.error.value;

    return networkError.value ?? recorderError?.message ?? null;
  });

  const isActive = computed(() => phase.value !== 'idle' && phase.value !== 'error');

  const isNearLimit = computed(
    () => recorder.isRecording.value && recorder.remainingSeconds.value <= SPEECH_DURATION_WARNING_SECONDS,
  );

  const transcribe = async (audio: Blob): Promise<void> => {
    requestId += 1;
    const current = requestId;

    controller?.abort();
    controller = new AbortController();

    networkPhase.value = 'uploading';
    networkError.value = null;

    try {
      // Upload and transcription are one request to the server; the split here
      // is honest about what the person is waiting for, which is the part they
      // can feel — bytes going up, then a model listening.
      const promise = speechService.transcribe(audio, { signal: controller.signal });

      networkPhase.value = 'transcribing';

      const result = await promise;

      // Superseded or abandoned: the words are dropped rather than applied to a
      // composer that has moved on.
      if (current !== requestId) {
        return;
      }

      options.onTranscript(result.text);
    } catch (caught) {
      if (isCancelled(caught) || current !== requestId) {
        return;
      }

      networkError.value = toErrorMessage(caught, 'Voice transcription failed. Please try again.');
    } finally {
      if (current === requestId) {
        networkPhase.value = 'idle';
      }
    }
  };

  const toggle = async (): Promise<void> => {
    networkError.value = null;

    if (recorder.isRecording.value) {
      const audio = await recorder.stop();

      if (audio) {
        await transcribe(audio);
      }

      return;
    }

    if (networkPhase.value !== 'idle') {
      return;
    }

    await recorder.start();
  };

  const cancel = (): void => {
    // Invalidates any transcription still in flight, so its answer cannot
    // arrive later and change the composer.
    requestId += 1;
    controller?.abort();
    controller = null;

    recorder.cancel();
    networkPhase.value = 'idle';
    networkError.value = null;
  };

  const dismissError = (): void => {
    networkError.value = null;
  };

  return {
    phase,
    elapsedSeconds: recorder.elapsedSeconds,
    remainingSeconds: recorder.remainingSeconds,
    isNearLimit,
    error,
    isSupported: recorder.isSupported,
    isActive,
    toggle,
    cancel,
    dismissError,
  };
};
