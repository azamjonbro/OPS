import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { speechService } from '@/services/speech.service';
import MessageComposer from './MessageComposer.vue';

/**
 * Dictation, from the microphone button to the composer.
 *
 * The whole point of this feature is what it does *not* do: a transcript is a
 * draft, never a sent message. Several of the cases below exist only to hold
 * that line, because it is the kind of behaviour a later refactor quietly
 * "improves" into auto-send.
 *
 * `MediaRecorder` and `getUserMedia` do not exist in happy-dom, so both are
 * stubbed here — the real ones are the browser's, and what is worth testing is
 * how this code reacts to them.
 */
class FakeMediaRecorder {
  static isTypeSupported = (type: string): boolean => type.startsWith('audio/webm');
  static instances: FakeMediaRecorder[] = [];

  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'audio/webm;codecs=opus';

  private readonly listeners = new Map<
    string,
    Array<{ handler: (event: unknown) => void; once: boolean }>
  >();

  constructor(
    public stream: MediaStream,
    public options?: { mimeType?: string },
  ) {
    FakeMediaRecorder.instances.push(this);

    if (options?.mimeType) {
      this.mimeType = options.mimeType;
    }
  }

  addEventListener(
    type: string,
    handler: (event: unknown) => void,
    options?: { once?: boolean },
  ): void {
    this.listeners.set(type, [
      ...(this.listeners.get(type) ?? []),
      { handler, once: options?.once ?? false },
    ]);
  }

  /**
   * `once` is honoured, as the real `MediaRecorder` honours it. Without that a
   * second `stop()` re-runs the handler against an already-drained buffer, and
   * the test invents a failure the browser would never produce.
   */
  private emit(type: string, event: unknown): void {
    const registered = this.listeners.get(type) ?? [];

    this.listeners.set(
      type,
      registered.filter((entry) => !entry.once),
    );

    for (const entry of registered) {
      entry.handler(event);
    }
  }

  start(): void {
    this.state = 'recording';
  }

  /** Emits a chunk of the given size, the way a real recorder would. */
  emitAudio(bytes = 4_096): void {
    this.emit('dataavailable', {
      data: new Blob([new Uint8Array(bytes)], { type: this.mimeType }),
    });
  }

  stop(): void {
    this.state = 'inactive';
    this.emit('stop', {});
  }
}

const stopTrack = vi.fn();

const installMediaStack = (
  getUserMedia: () => Promise<MediaStream> = async () =>
    ({ getTracks: () => [{ stop: stopTrack }] }) as unknown as MediaStream,
): void => {
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('navigator', {
    ...window.navigator,
    mediaDevices: { getUserMedia },
  });
};

const mountComposer = () =>
  mount(MessageComposer, { attachTo: document.body, global: { plugins: [createPinia()] } });

const micButton = (wrapper: ReturnType<typeof mountComposer>) =>
  wrapper.find('button[aria-label="Start voice input"]');

const stopButton = (wrapper: ReturnType<typeof mountComposer>) =>
  wrapper.find('button[aria-label="Stop recording and transcribe"]');

/** Starts a recording and returns the recorder the composable created. */
const startRecording = async (
  wrapper: ReturnType<typeof mountComposer>,
): Promise<FakeMediaRecorder> => {
  await micButton(wrapper).trigger('click');
  await flushPromises();

  const recorder = FakeMediaRecorder.instances.at(-1);

  if (!recorder) {
    throw new Error('No recording was started');
  }

  recorder.emitAudio();

  return recorder;
};

beforeEach(() => {
  setActivePinia(createPinia());
  FakeMediaRecorder.instances = [];
  stopTrack.mockClear();
  installMediaStack();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('the microphone button', () => {
  it('is offered beside the composer, with a label rather than only an icon', () => {
    const wrapper = mountComposer();
    const button = micButton(wrapper);

    expect(button.exists()).toBe(true);
    expect(button.attributes('aria-label')).toBe('Start voice input');
    expect(button.attributes('title')).toBe('Start voice input');
  });

  it('is disabled, and says why, where the browser cannot record', () => {
    vi.stubGlobal('MediaRecorder', undefined);
    const wrapper = mountComposer();

    const button = wrapper.find(
      'button[aria-label="Voice input is not available in this browser"]',
    );
    expect(button.exists()).toBe(true);
    expect(button.attributes('disabled')).toBeDefined();
  });
});

describe('recording', () => {
  it('shows that the microphone is live, with a running clock', async () => {
    vi.useFakeTimers();
    const wrapper = mountComposer();

    await micButton(wrapper).trigger('click');
    await flushPromises();

    expect(stopButton(wrapper).exists()).toBe(true);
    expect(wrapper.text()).toContain('0:00');

    vi.advanceTimersByTime(3_000);
    await flushPromises();

    expect(wrapper.text()).toContain('0:03');
    vi.useRealTimers();
  });

  it('offers a way out that is not the button that started it', async () => {
    const wrapper = mountComposer();
    await micButton(wrapper).trigger('click');
    await flushPromises();

    expect(wrapper.findAll('button').some((button) => button.text() === 'Cancel')).toBe(true);
  });

  it('explains a refused microphone in words a person can act on', async () => {
    const denied = new Error('denied');
    denied.name = 'NotAllowedError';
    installMediaStack(() => Promise.reject(denied));

    const wrapper = mountComposer();
    await micButton(wrapper).trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Microphone permission is required');
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
  });

  it('reports a device with no microphone as such', async () => {
    const missing = new Error('none');
    missing.name = 'NotFoundError';
    installMediaStack(() => Promise.reject(missing));

    const wrapper = mountComposer();
    await micButton(wrapper).trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('No microphone was found');
  });
});

describe('stopping', () => {
  it('uploads the recording and puts the words in the composer', async () => {
    const transcribe = vi.spyOn(speechService, 'transcribe').mockResolvedValue({
      text: 'Bugungi savdoni tahlil qilib ber',
      durationSeconds: 3,
      language: 'uz',
      model: 'whisper-1',
    });

    const wrapper = mountComposer();
    const recorder = await startRecording(wrapper);

    await stopButton(wrapper).trigger('click');
    recorder.stop();
    await flushPromises();

    expect(transcribe).toHaveBeenCalledTimes(1);
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe(
      'Bugungi savdoni tahlil qilib ber',
    );
  });

  it('releases the microphone when it is done', async () => {
    vi.spyOn(speechService, 'transcribe').mockResolvedValue({
      text: 'salom',
      durationSeconds: 1,
      language: 'uz',
      model: 'whisper-1',
    });

    const wrapper = mountComposer();
    const recorder = await startRecording(wrapper);

    await stopButton(wrapper).trigger('click');
    recorder.stop();
    await flushPromises();

    // A track left open leaves the browser's recording light on, which is
    // alarming and entirely our fault when it happens.
    expect(stopTrack).toHaveBeenCalled();
  });

  it('appends to what is already written rather than replacing it', async () => {
    vi.spyOn(speechService, 'transcribe').mockResolvedValue({
      text: 'kecha bilan solishtir',
      durationSeconds: 2,
      language: 'uz',
      model: 'whisper-1',
    });

    const wrapper = mountComposer();
    const textarea = wrapper.find('textarea');
    await textarea.setValue('Bugungi savdoni tahlil qil,');

    const recorder = await startRecording(wrapper);
    await stopButton(wrapper).trigger('click');
    recorder.stop();
    await flushPromises();

    expect((textarea.element as HTMLTextAreaElement).value).toBe(
      'Bugungi savdoni tahlil qil, kecha bilan solishtir',
    );
  });

  it('says so when nothing usable was captured, and leaves the field alone', async () => {
    const transcribe = vi.spyOn(speechService, 'transcribe');

    const wrapper = mountComposer();
    await micButton(wrapper).trigger('click');
    await flushPromises();

    const recorder = FakeMediaRecorder.instances.at(-1);
    // A click, not speech.
    recorder?.emitAudio(16);

    await stopButton(wrapper).trigger('click');
    recorder?.stop();
    await flushPromises();

    expect(transcribe).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('too short');
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('');
  });
});

describe('cancelling', () => {
  it('throws the recording away without transcribing or touching the input', async () => {
    const transcribe = vi.spyOn(speechService, 'transcribe');

    const wrapper = mountComposer();
    const textarea = wrapper.find('textarea');
    await textarea.setValue('typed by hand');

    const recorder = await startRecording(wrapper);

    const cancel = wrapper.findAll('button').find((button) => button.text() === 'Cancel');
    await cancel?.trigger('click');
    recorder.stop();
    await flushPromises();

    expect(transcribe).not.toHaveBeenCalled();
    expect((textarea.element as HTMLTextAreaElement).value).toBe('typed by hand');
    expect(stopTrack).toHaveBeenCalled();
  });
});

describe('the transcript is a draft, never a message', () => {
  it('does not send when the transcript arrives', async () => {
    vi.spyOn(speechService, 'transcribe').mockResolvedValue({
      text: 'Bugungi savdoni tahlil qilib ber',
      durationSeconds: 3,
      language: 'uz',
      model: 'whisper-1',
    });

    const wrapper = mountComposer();
    const recorder = await startRecording(wrapper);

    await stopButton(wrapper).trigger('click');
    recorder.stop();
    await flushPromises();

    // The line this feature must never cross: a misheard word would otherwise
    // become a message nobody chose to send.
    expect(wrapper.emitted('send')).toBeUndefined();
  });

  it('is editable, and sends through the ordinary send path when the person chooses', async () => {
    vi.spyOn(speechService, 'transcribe').mockResolvedValue({
      text: 'Bugungi savdoni tahlil qilib ber',
      durationSeconds: 3,
      language: 'uz',
      model: 'whisper-1',
    });

    const wrapper = mountComposer();
    const recorder = await startRecording(wrapper);
    await stopButton(wrapper).trigger('click');
    recorder.stop();
    await flushPromises();

    const textarea = wrapper.find('textarea');
    await textarea.setValue('Bugungi savdoni tahlil qilib ber, kecha bilan ham solishtir.');
    await textarea.trigger('keydown', { key: 'Enter' });

    expect(wrapper.emitted('send')?.[0]).toEqual([
      'Bugungi savdoni tahlil qilib ber, kecha bilan ham solishtir.',
    ]);
  });
});

describe('when transcription races the typist', () => {
  it('keeps what was typed while the model was listening', async () => {
    let resolve:
      | ((value: { text: string; durationSeconds: null; language: null; model: string }) => void)
      | undefined;

    vi.spyOn(speechService, 'transcribe').mockReturnValue(
      new Promise((settle) => {
        resolve = settle;
      }),
    );

    const wrapper = mountComposer();
    const recorder = await startRecording(wrapper);
    await stopButton(wrapper).trigger('click');
    recorder.stop();
    await flushPromises();

    // The person carries on typing while the transcription is in flight.
    const textarea = wrapper.find('textarea');
    await textarea.setValue('typed while waiting');

    resolve?.({ text: 'dictated', durationSeconds: null, language: null, model: 'whisper-1' });
    await flushPromises();

    // Nothing is overwritten; the transcript joins the end.
    expect((textarea.element as HTMLTextAreaElement).value).toBe('typed while waiting dictated');
  });

  it('drops a transcript the person cancelled before it arrived', async () => {
    let resolve:
      | ((value: { text: string; durationSeconds: null; language: null; model: string }) => void)
      | undefined;

    vi.spyOn(speechService, 'transcribe').mockReturnValue(
      new Promise((settle) => {
        resolve = settle;
      }),
    );

    const wrapper = mountComposer();
    const recorder = await startRecording(wrapper);
    await stopButton(wrapper).trigger('click');
    recorder.stop();
    await flushPromises();

    // Cancelling is offered during transcription too, which is the longest
    // wait in the feature.
    const cancel = wrapper.findAll('button').find((button) => button.text() === 'Cancel');
    await cancel?.trigger('click');
    await flushPromises();

    resolve?.({ text: 'stale', durationSeconds: null, language: null, model: 'whisper-1' });
    await flushPromises();

    // The request was superseded, so its answer is discarded rather than
    // landing in a composer that has moved on.
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('');
  });
});

describe('when the service fails', () => {
  it('shows a human message and leaves the field untouched', async () => {
    vi.spyOn(speechService, 'transcribe').mockRejectedValue(
      Object.assign(new Error('Voice transcription failed. Please try again.'), {
        name: 'ApiClientError',
      }),
    );

    const wrapper = mountComposer();
    const textarea = wrapper.find('textarea');
    await textarea.setValue('kept');

    const recorder = await startRecording(wrapper);
    await stopButton(wrapper).trigger('click');
    recorder.stop();
    await flushPromises();

    expect(wrapper.text()).toContain('Voice transcription failed');
    expect((textarea.element as HTMLTextAreaElement).value).toBe('kept');
  });

  it('lets the person dismiss the message and try again', async () => {
    vi.spyOn(speechService, 'transcribe').mockRejectedValue(
      new Error('Voice transcription failed.'),
    );

    const wrapper = mountComposer();
    const recorder = await startRecording(wrapper);
    await stopButton(wrapper).trigger('click');
    recorder.stop();
    await flushPromises();

    const dismiss = wrapper.findAll('button').find((button) => button.text() === 'Dismiss');
    await dismiss?.trigger('click');
    await flushPromises();

    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(micButton(wrapper).exists()).toBe(true);
  });
});
