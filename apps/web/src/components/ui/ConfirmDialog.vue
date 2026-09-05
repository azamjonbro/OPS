<script setup lang="ts">
import BaseButton from './BaseButton.vue';
import BaseModal from './BaseModal.vue';

withDefaults(
  defineProps<{
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
    busy?: boolean;
  }>(),
  {
    confirmLabel: 'Confirm',
    cancelLabel: 'Cancel',
    danger: true,
    busy: false,
  },
);

const emit = defineEmits<{ confirm: []; cancel: [] }>();

/**
 * The one confirmation in the application.
 *
 * Destructive actions get a dialog rather than an inline "are you sure?",
 * because a mis-click on a list row should not be able to delete the thing
 * under the cursor. The confirm button is disabled while the action runs, so a
 * slow delete cannot be submitted twice.
 */
const open = defineModel<boolean>('open', { required: true });
</script>

<template>
  <BaseModal v-model:open="open" :title="title" size="sm" @close="emit('cancel')">
    <p class="text-sm text-ink-700">{{ message }}</p>

    <template #footer>
      <BaseButton variant="ghost" :disabled="busy" @click="open = false">
        {{ cancelLabel }}
      </BaseButton>
      <BaseButton :variant="danger ? 'danger' : 'primary'" :loading="busy" @click="emit('confirm')">
        {{ confirmLabel }}
      </BaseButton>
    </template>
  </BaseModal>
</template>
