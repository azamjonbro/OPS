<script setup lang="ts">
import { DOCUMENT_ACCEPT_ATTRIBUTE } from '@hadiya/shared';
import { computed, nextTick, ref, useId, watch } from 'vue';

import AttachmentChip from './AttachmentChip.vue';
import RecordingIndicator from './RecordingIndicator.vue';
import TranscriptionStatus from './TranscriptionStatus.vue';
import VoiceInputButton from './VoiceInputButton.vue';
import { useFileUpload } from '@/composables/useFileUpload';
import { useVoiceInput } from '@/composables/useVoiceInput';

const props = withDefaults(
  defineProps<{
    busy?: boolean;
    /**
     * Whether the run can be stopped.
     *
     * Separate from `busy`, because they are not the same moment: a turn is
     * busy from the instant Enter is pressed, and is stoppable only once the
     * server has a run to stop. Offering Stop before there is anything to stop
     * would be a button that does nothing.
     */
    stoppable?: boolean;
    /** True once a stop has been asked for, so it cannot be asked for twice. */
    stopping?: boolean;
    placeholder?: string;
    autofocus?: boolean;
  }>(),
  {
    busy: false,
    stoppable: false,
    stopping: false,
    placeholder: 'Ask Hadiya anything about your business…',
    autofocus: true,
  },
);
const emit = defineEmits<{ send: [text: string, fileIds: string[]]; stop: [] }>();
/**
 * Where a turn is written.
 *
 * Enter sends and Shift+Enter breaks the line, which is what everyone expects
 * of a chat and the opposite of what a bare textarea does. The box grows with
 * the text up to a ceiling and then scrolls, so a long dictated message is
 * visible without the transcript being squeezed off the screen.
 *
 * The input is *not* disabled while the assistant is answering. Somebody should
 * be able to start typing their next thought during a slow reply; only sending
 * waits. Disabling the field would also move focus away and, on a phone, close
 * the keyboard mid-sentence.
 *
 * Attachments sit in a row above the textarea and travel with the emitted
 * payload rather than being read out of the field. Picking one uploads it at
 * once — so a problem with it surfaces while the person is still here — but it
 * becomes part of a message only when Send is pressed.
 *
 * Dictation writes into this same field and does not send. A transcript is a
 * draft like any other: it can be read, corrected and abandoned, and it becomes
 * a message only when the person presses Send — which runs the ordinary
 * `send()` below, not a second path.
 */
const MAX_LENGTH = 8_000;
const MIN_HEIGHT_PX = 24;
const MAX_HEIGHT_PX = 200;

const id = useId();
const text = ref('');
const textarea = ref<HTMLTextAreaElement | null>(null);

const trimmed = computed(() => text.value.trim());
/**
 * A turn needs something in it and nothing still arriving.
 *
 * An attached document counts as content on its own — "bu faylni analiz qil"
 * with the file attached and no typing is a perfectly ordinary request — but a
 * file that is still uploading holds Send back, because sending a reference to
 * a document the server has not finished reading produces an answer about
 * nothing.
 */
const canSend = computed(
  () =>
    (trimmed.value.length > 0 || files.readyFiles().length > 0) &&
    !props.busy &&
    !files.isUploading.value,
);
/**
 * The primary button becomes Stop while there is a run to stop.
 *
 * One control rather than two, in the place the thumb is already resting: on a
 * phone, a Stop button somewhere else on the screen is a Stop button nobody
 * finds in time.
 */
const isStop = computed(() => props.stoppable && !props.stopping);
const isOverLength = computed(() => text.value.length > MAX_LENGTH);
/** Only worth showing near the limit; a counter on every message is nagging. */
const showCounter = computed(() => text.value.length > MAX_LENGTH * 0.9);

const resize = (): void => {
  const element = textarea.value;

  if (!element) {
    return;
  }

  element.style.height = 'auto';
  element.style.height = `${Math.min(Math.max(element.scrollHeight, MIN_HEIGHT_PX), MAX_HEIGHT_PX)}px`;
};

watch(text, () => void nextTick(resize));

const focus = (): void => {
  textarea.value?.focus();
};

/**
 * What a screen reader is told when dictation finishes.
 *
 * Without this the transcript simply appears in a field nobody is looking at:
 * the spinner vanishes and there is no announcement, so somebody using a screen
 * reader cannot tell a finished transcription from one still running. The
 * recording and transcribing states announce themselves; this is the ending
 * they were missing.
 */
const voiceAnnouncement = ref('');

/**
 * Where a transcript lands.
 *
 * Appended rather than assigned, and to whatever is in the field *now* rather
 * than to whatever was there when recording started. Somebody who typed a
 * sentence while the model was listening keeps it, and the dictated words join
 * the end — the one outcome that can never destroy work. A separating space is
 * added only when there is something to separate from.
 */
const insertTranscript = (transcript: string): void => {
  const existing = text.value.trimEnd();
  const separator = existing.length > 0 ? ' ' : '';

  text.value = `${existing}${separator}${transcript}`;
  // The words are read back as well as announced, so somebody who cannot see
  // the field hears what landed in it.
  voiceAnnouncement.value = `Transcript added to your message: ${transcript}`;

  void nextTick(() => {
    resize();
    // Focus lands at the end so the person can carry straight on typing or
    // correct the last word without hunting for the caret.
    const element = textarea.value;
    element?.focus();
    element?.setSelectionRange(text.value.length, text.value.length);
  });
};

/**
 * Documents attached to this turn.
 *
 * Picking a file uploads it immediately — so it can be read, and so a problem
 * with it surfaces while the person is still looking at the composer — but it
 * never sends anything. The attachment becomes part of a message only when Send
 * is pressed, which is the same rule dictation follows.
 */
const files = useFileUpload();
const filePicker = ref<HTMLInputElement | null>(null);

const onFilesPicked = async (event: Event): Promise<void> => {
  const input = event.target as HTMLInputElement;
  const picked = [...(input.files ?? [])];

  // Cleared straight away so picking the same file twice in a row still fires
  // a change event.
  input.value = '';

  if (picked.length > 0) {
    await files.add(picked);
  }
};

const voice = useVoiceInput({ onTranscript: insertTranscript });

/** Starting again clears the last announcement, so it cannot be read as new. */
const onVoiceActivate = (): void => {
  voiceAnnouncement.value = '';
  void voice.toggle();
};

const send = (): void => {
  if (!canSend.value || isOverLength.value) {
    return;
  }

  emit(
    'send',
    trimmed.value,
    files.readyFiles().map((file) => file.id),
  );
  // Cleared straight away: the message is optimistic upstream, so a failure
  // puts the words back rather than this holding on to them.
  text.value = '';
  files.clear();
  void nextTick(resize);
};

const onKeydown = (event: KeyboardEvent): void => {
  // `isComposing` matters for anyone typing through an IME: Enter there commits
  // a candidate word and must not send a half-written message.
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
    return;
  }

  event.preventDefault();
  send();
};

/** Lets the page drop a suggestion in and hand the person a ready sentence. */
const setText = (value: string): void => {
  text.value = value;
  void nextTick(() => {
    resize();
    focus();
  });
};

defineExpose({ focus, setText });
</script>

<template>
  <div class="border-t border-border-subtle bg-surface px-4 py-4 sm:px-6">
    <div class="mx-auto w-full max-w-3xl">
      <label :for="id" class="sr-only">Message Hadiya</label>

      <div
        v-if="files.attachments.value.length > 0"
        class="mb-2 flex flex-col gap-2"
        aria-label="Attached documents"
      >
        <AttachmentChip
          v-for="attachment in files.attachments.value"
          :key="attachment.localId"
          :attachment="attachment"
          @remove="files.remove"
        />
      </div>

      <div
        class="flex items-end gap-3 rounded-[24px] bg-surface-muted px-4 py-2 ring-1 ring-border-subtle shadow-sm transition-all duration-300 focus-within:bg-surface focus-within:ring-2 focus-within:ring-brand-500 focus-within:shadow-md"
      >
        <textarea
          :id="id"
          ref="textarea"
          v-model="text"
          rows="1"
          :placeholder="placeholder"
          :autofocus="autofocus"
          :aria-invalid="isOverLength"
          :aria-describedby="showCounter ? `${id}-counter` : undefined"
          class="max-h-[200px] min-h-6 w-full resize-none border-0 bg-transparent py-2.5 text-[15px] leading-relaxed text-ink-900 placeholder:text-ink-400 focus:outline-none"
          @keydown="onKeydown"
        />

        <input
          ref="filePicker"
          type="file"
          class="sr-only"
          :accept="DOCUMENT_ACCEPT_ATTRIBUTE"
          multiple
          tabindex="-1"
          aria-hidden="true"
          @change="onFilesPicked"
        />

        <button
          type="button"
          class="relative mb-1.5 grid size-[34px] shrink-0 touch-manipulation place-items-center rounded-[12px] text-ink-500 transition-all duration-200 after:absolute after:-inset-[5px] after:content-[''] hover:bg-border-subtle/60 hover:text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
          aria-label="Attach a document"
          title="Attach a document"
          @click="filePicker?.click()"
        >
          <svg
            class="size-[18px]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>

        <VoiceInputButton
          :phase="voice.phase.value"
          :supported="voice.isSupported.value"
          @activate="onVoiceActivate"
        />

        <button
          v-if="isStop"
          type="button"
          class="mb-1.5 grid size-[34px] shrink-0 place-items-center rounded-[12px] bg-ink-900 text-surface shadow-sm transition-all duration-200 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ink-900 focus:ring-offset-2"
          aria-label="Stop Hadiya"
          @click="emit('stop')"
        >
          <svg class="size-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" />
          </svg>
        </button>

        <button
          v-else
          type="button"
          class="mb-1.5 grid size-[34px] shrink-0 place-items-center rounded-[12px] bg-brand-500 text-white shadow-sm transition-all duration-200 hover:bg-brand-600 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100 dark:bg-brand-600 dark:hover:bg-brand-500"
          :disabled="!canSend || isOverLength"
          :aria-label="busy ? 'Hadiya is answering' : 'Send message'"
          @click="send"
        >
          <svg
            v-if="busy"
            class="size-4 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle
              class="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              stroke-width="4"
            />
            <path
              class="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4Z"
            />
          </svg>
          <svg
            v-else
            class="size-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </div>

      <div
        v-if="voice.isActive.value || voice.error.value"
        class="mt-2 flex flex-wrap items-center gap-3 px-2"
      >
        <RecordingIndicator
          v-if="voice.phase.value === 'recording'"
          :elapsed-seconds="voice.elapsedSeconds.value"
          :remaining-seconds="voice.remainingSeconds.value"
          :near-limit="voice.isNearLimit.value"
          @stop="onVoiceActivate"
          @cancel="voice.cancel"
        />

        <TranscriptionStatus :phase="voice.phase.value" @cancel="voice.cancel" />

        <p
          v-if="voice.error.value"
          class="flex items-center gap-2 text-[11px] text-danger-600"
          role="alert"
        >
          {{ voice.error.value }}
          <button
            type="button"
            class="rounded px-1 py-0.5 font-medium underline hover:text-danger-700 focus:outline-none focus:ring-2 focus:ring-danger-600"
            @click="voice.dismissError"
          >
            Dismiss
          </button>
        </p>
      </div>

      <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {{ voiceAnnouncement }}
      </p>

      <div class="mt-2 flex items-center justify-between gap-3 px-2">
        <p class="text-[11px] font-medium text-ink-400/80">
          <kbd class="font-sans">Enter</kbd> to send ·
          <kbd class="font-sans">Shift + Enter</kbd> for a new line
        </p>
        <p
          v-if="showCounter"
          :id="`${id}-counter`"
          class="shrink-0 text-[11px] font-medium tabular-nums"
          :class="isOverLength ? 'text-danger-600' : 'text-ink-400'"
        >
          {{ text.length }} / {{ MAX_LENGTH }}
        </p>
      </div>
    </div>
  </div>
</template>
