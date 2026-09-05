import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { speechService } from '@/services/speech.service';
import MessageComposer from '@/components/chat/MessageComposer.vue';

class FakeMediaRecorder {
  static isTypeSupported = (t: string) => t.startsWith('audio/webm');
  static instances: FakeMediaRecorder[] = [];
  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'audio/webm;codecs=opus';
  private l = new Map<string, Array<(e: unknown) => void>>();
  constructor(public stream: MediaStream) { FakeMediaRecorder.instances.push(this); }
  addEventListener(t: string, h: (e: unknown) => void) { this.l.set(t, [...(this.l.get(t) ?? []), h]); }
  private emit(t: string, e: unknown) { for (const h of this.l.get(t) ?? []) h(e); }
  start() { this.state = 'recording'; }
  emitAudio(b = 4096) { this.emit('dataavailable', { data: new Blob([new Uint8Array(b)], { type: this.mimeType }) }); }
  stop() { this.state = 'inactive'; this.emit('stop', {}); }
}

beforeEach(() => {
  setActivePinia(createPinia());
  FakeMediaRecorder.instances = [];
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('navigator', { ...window.navigator, mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => undefined }] }) as unknown as MediaStream } });
});

describe('debug', () => {
  it('dismiss', async () => {
    vi.spyOn(speechService, 'transcribe').mockRejectedValue(new Error('Voice transcription failed.'));
    const wrapper = mount(MessageComposer, { attachTo: document.body, global: { plugins: [createPinia()] } });
    await wrapper.find('button[aria-label="Start voice input"]').trigger('click');
    await flushPromises();
    const r = FakeMediaRecorder.instances.at(-1)!;
    r.emitAudio();
    await wrapper.find('button[aria-label="Stop recording and transcribe"]').trigger('click');
    r.stop();
    await flushPromises();
    console.log('BEFORE:', JSON.stringify(wrapper.find('[role="alert"]').exists()), wrapper.text().slice(-160));
    const dismiss = wrapper.findAll('button').find((b) => b.text() === 'Dismiss');
    console.log('dismiss found:', !!dismiss);
    await dismiss?.trigger('click');
    await flushPromises();
    console.log('AFTER exists:', wrapper.find('[role="alert"]').exists());
    console.log('AFTER html:', wrapper.find('[role="alert"]').exists() ? wrapper.find('[role="alert"]').html().slice(0, 200) : '(none)');
    expect(true).toBe(true);
  });
});
