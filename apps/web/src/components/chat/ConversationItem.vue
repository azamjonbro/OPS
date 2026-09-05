<script setup lang="ts">
import type { Conversation } from '@hadiya/shared';
import { computed, nextTick, ref } from 'vue';

const props = defineProps<{ conversation: Conversation; active: boolean }>();

const emit = defineEmits<{
  open: [id: string];
  rename: [id: string, title: string];
  archive: [id: string];
  remove: [conversation: Conversation];
}>();

const isEditing = ref(false);
const draft = ref('');
const input = ref<HTMLInputElement | null>(null);
const isMenuOpen = ref(false);

const title = computed(() => props.conversation.title || 'New conversation');

const startRename = async (): Promise<void> => {
  isMenuOpen.value = false;
  draft.value = title.value;
  isEditing.value = true;
  await nextTick();
  input.value?.select();
};

const commitRename = (): void => {
  const next = draft.value.trim();

  isEditing.value = false;

  if (next.length > 0 && next !== title.value) {
    emit('rename', props.conversation.id, next);
  }
};

const cancelRename = (): void => {
  isEditing.value = false;
};

const closeMenu = (): void => {
  isMenuOpen.value = false;
};
</script>

<template>
  <li class="group/row relative">
    <input
      v-if="isEditing"
      ref="input"
      v-model="draft"
      type="text"
      maxlength="120"
      aria-label="Conversation title"
      class="w-full rounded-lg bg-surface px-3 py-2 text-[13px] text-ink-900 shadow-sm ring-1 ring-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
      @keydown.enter.prevent="commitRename"
      @keydown.esc.prevent="cancelRename"
      @blur="commitRename"
    />

    <div v-else class="flex items-center">
      <button
        type="button"
        class="flex min-w-0 flex-1 items-center rounded-lg px-3 py-2 text-left text-[13px] transition-all duration-200 relative overflow-hidden"
        :class="
          active
            ? 'bg-surface font-semibold text-ink-900 shadow-sm ring-1 ring-border-subtle'
            : 'font-medium text-ink-500 hover:bg-surface hover:text-ink-900'
        "
        :aria-current="active ? 'page' : undefined"
        @click="emit('open', conversation.id)"
      >
        <div v-if="active" class="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r-full bg-brand-500" aria-hidden="true" />
        <span class="truncate pl-0.5">{{ title }}</span>
      </button>

      <button
        type="button"
        class="absolute right-1.5 rounded-md p-1.5 text-ink-400 opacity-0 transition-opacity hover:bg-surface-raised hover:text-ink-900 focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-brand-500 group-hover/row:opacity-100"
        :class="isMenuOpen ? 'opacity-100' : ''"
        :aria-expanded="isMenuOpen"
        aria-haspopup="menu"
        :aria-label="`Actions for ${title}`"
        @click.stop="isMenuOpen = !isMenuOpen"
      >
        <svg class="size-[15px]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      </button>
    </div>

    <!-- Dropdown Menu -->
    <template v-if="isMenuOpen">
      <div class="fixed inset-0 z-20" aria-hidden="true" @click.stop="closeMenu" />
      <div
        role="menu"
        class="absolute right-1 top-9 z-30 w-36 overflow-hidden rounded-lg bg-surface-raised py-1 text-[13px] font-medium shadow-lg ring-1 ring-border-subtle"
      >
        <button
          type="button"
          role="menuitem"
          class="block w-full px-3 py-1.5 text-left text-ink-700 hover:bg-surface-muted hover:text-ink-900"
          @click="startRename"
        >
          Rename
        </button>
        <button
          type="button"
          role="menuitem"
          class="block w-full px-3 py-1.5 text-left text-ink-700 hover:bg-surface-muted hover:text-ink-900"
          @click="
            closeMenu();
            emit('archive', conversation.id);
          "
        >
          Archive
        </button>
        <div class="my-1 h-px bg-border-subtle" />
        <button
          type="button"
          role="menuitem"
          class="block w-full px-3 py-1.5 text-left text-danger-600 hover:bg-danger-50"
          @click="
            closeMenu();
            emit('remove', conversation);
          "
        >
          Delete
        </button>
      </div>
    </template>
  </li>
</template>
