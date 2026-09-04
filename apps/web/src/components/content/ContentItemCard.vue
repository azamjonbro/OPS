<script setup lang="ts">
import type { ContentItem } from '@hadiya/shared';
import { ref } from 'vue';

import ContentItemImages from '@/components/content/ContentItemImages.vue';
import BaseButton from '@/components/ui/BaseButton.vue';

/**
 * One day of a plan, editable in place.
 *
 * Editing opens on the card rather than on a separate screen because the change
 * is nearly always small — a shorter caption, different hashtags — and only the
 * fields that were touched are sent, so nothing the person approved is
 * overwritten by a form that resubmitted its own defaults.
 */
const props = defineProps<{ item: ContentItem; busy: boolean }>();

const emit = defineEmits<{
  save: [id: string, changes: Record<string, unknown>];
  regenerate: [id: string, instruction: string];
  remove: [id: string];
}>();

const isEditing = ref(false);
const isConfirmingDelete = ref(false);
const instruction = ref('');
const draft = ref({ title: '', caption: '', callToAction: '', hashtags: '' });

const startEditing = (): void => {
  draft.value = {
    title: props.item.title,
    caption: props.item.caption ?? '',
    callToAction: props.item.callToAction ?? '',
    hashtags: props.item.hashtags.join(' '),
  };
  isEditing.value = true;
};

const save = (): void => {
  emit('save', props.item.id, {
    title: draft.value.title,
    caption: draft.value.caption || null,
    callToAction: draft.value.callToAction || null,
    hashtags: draft.value.hashtags
      .split(/[\s,]+/)
      .map((tag) => tag.replace(/^#+/, ''))
      .filter((tag) => tag.length > 0),
  });
  isEditing.value = false;
};

const regenerate = (): void => {
  emit('regenerate', props.item.id, instruction.value.trim());
  instruction.value = '';
};

const fieldClasses =
  'w-full rounded-lg px-3 py-2 text-sm text-ink-900 ring-1 ring-inset ring-border-subtle focus:outline-none focus:ring-2 focus:ring-brand-600';

const STATUS_CLASSES: Record<string, string> = {
  idea: 'bg-surface-muted text-ink-500 ring-border-subtle',
  draft: 'bg-amber-50 text-amber-700 ring-amber-200',
  ready: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  published: 'bg-brand-50 text-brand-700 ring-brand-200',
  skipped: 'bg-surface-muted text-ink-500 ring-border-subtle',
};
</script>

<template>
  <li class="flex flex-col gap-3 px-4 py-4">
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <p class="text-xs text-ink-500">
          {{ item.date.slice(0, 10) }} · {{ item.platform }} · {{ item.contentType }}
        </p>
        <p class="mt-0.5 truncate text-sm font-medium text-ink-900">{{ item.title }}</p>
      </div>
      <span
        class="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset"
        :class="STATUS_CLASSES[item.status] ?? STATUS_CLASSES.idea"
      >
        {{ item.status }}
      </span>
    </div>

    <div v-if="!isEditing" class="flex flex-col gap-2">
      <p class="text-xs text-ink-500">{{ item.idea }}</p>
      <p v-if="item.caption" class="whitespace-pre-line text-sm text-ink-700">
        {{ item.caption }}
      </p>
      <p v-else class="text-sm italic text-ink-500">No caption written yet.</p>
      <p v-if="item.callToAction" class="text-xs font-medium text-ink-700">
        {{ item.callToAction }}
      </p>
      <p v-if="item.hashtags.length > 0" class="text-xs text-brand-700">
        {{ item.hashtags.map((tag) => `#${tag}`).join(' ') }}
      </p>
    </div>

    <div v-else class="flex flex-col gap-2">
      <input v-model="draft.title" :class="fieldClasses" placeholder="Title" />
      <textarea v-model="draft.caption" rows="4" :class="fieldClasses" placeholder="Caption" />
      <input v-model="draft.callToAction" :class="fieldClasses" placeholder="Call to action" />
      <input
        v-model="draft.hashtags"
        :class="fieldClasses"
        placeholder="hashtags separated by spaces"
      />
    </div>

    <ContentItemImages v-if="!isEditing" :content-item-id="item.id" />

    <div class="flex flex-wrap items-center gap-2">
      <template v-if="isEditing">
        <BaseButton size="sm" :loading="busy" @click="save">Save</BaseButton>
        <BaseButton size="sm" variant="ghost" @click="isEditing = false">Cancel</BaseButton>
      </template>
      <template v-else>
        <BaseButton size="sm" variant="secondary" @click="startEditing">Edit</BaseButton>
        <input
          v-model="instruction"
          :class="[fieldClasses, 'h-8 max-w-56 flex-1 py-0']"
          placeholder="e.g. qisqartir"
          @keyup.enter="regenerate"
        />
        <BaseButton size="sm" variant="secondary" :loading="busy" @click="regenerate">
          Rewrite
        </BaseButton>
        <template v-if="isConfirmingDelete">
          <span class="text-xs text-ink-500">Delete this day?</span>
          <BaseButton size="sm" variant="secondary" @click="emit('remove', item.id)">
            Yes, delete
          </BaseButton>
          <BaseButton size="sm" variant="ghost" @click="isConfirmingDelete = false">No</BaseButton>
        </template>
        <BaseButton v-else size="sm" variant="ghost" @click="isConfirmingDelete = true">
          Delete
        </BaseButton>
      </template>
    </div>
  </li>
</template>
