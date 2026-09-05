<script setup lang="ts">
import type { Conversation } from '@hadiya/shared';
import { computed, nextTick, ref } from 'vue';

/**
 * One thread in the sidebar.
 *
 * Renaming happens in place rather than in a dialog: it is a two-word edit, and
 * a modal for it would be three clicks where one should do. Escape abandons the
 * edit and Enter commits it, so the keyboard can do the whole thing.
 *
 * Deleting only *asks* here. The confirmation lives above, because a row that
 * can destroy a conversation on its own is a row that will eventually destroy
 * the wrong one.
 */
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
      class="w-full rounded-lg bg-slate-800 px-2.5 py-2 text-sm text-white ring-1 ring-brand-600 focus:outline-none"
      @keydown.enter.prevent="commitRename"
      @keydown.esc.prevent="cancelRename"
      @blur="commitRename"
    />

    <div v-else class="flex items-center">
      <button
        type="button"
        class="flex min-w-0 flex-1 items-center rounded-lg px-2.5 py-2 text-left text-sm transition-colors"
        :class="
          active
            ? 'bg-slate-800 font-medium text-white'
            : 'text-slate-300 hover:bg-slate-800 hover:text-white'
        "
        :aria-current="active ? 'page' : undefined"
        @click="emit('open', conversation.id)"
      >
        <span class="truncate">{{ title }}</span>
      </button>

      <button
        type="button"
        class="absolute right-1 rounded-md p-1.5 text-slate-400 opacity-0 transition-opacity hover:bg-slate-700 hover:text-white focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-brand-600 group-hover/row:opacity-100"
        :class="isMenuOpen ? 'opacity-100' : ''"
        :aria-expanded="isMenuOpen"
        aria-haspopup="menu"
        :aria-label="`Actions for ${title}`"
        @click="isMenuOpen = !isMenuOpen"
      >
        <svg class="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      </button>
    </div>

    <!-- A click anywhere else closes the menu; the backdrop is what catches it. -->
    <template v-if="isMenuOpen">
      <div class="fixed inset-0 z-20" aria-hidden="true" @click="closeMenu" />
      <div
        role="menu"
        class="absolute right-1 top-9 z-30 w-40 overflow-hidden rounded-lg bg-slate-800 py-1 text-sm shadow-xl ring-1 ring-slate-700"
      >
        <button
          type="button"
          role="menuitem"
          class="block w-full px-3 py-2 text-left text-slate-200 hover:bg-slate-700"
          @click="startRename"
        >
          Rename
        </button>
        <button
          type="button"
          role="menuitem"
          class="block w-full px-3 py-2 text-left text-slate-200 hover:bg-slate-700"
          @click="
            closeMenu();
            emit('archive', conversation.id);
          "
        >
          Archive
        </button>
        <button
          type="button"
          role="menuitem"
          class="block w-full px-3 py-2 text-left text-red-400 hover:bg-slate-700"
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
