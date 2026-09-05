<script setup lang="ts">
import type { Conversation } from '@hadiya/shared';
import { computed } from 'vue';

import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';

const props = withDefaults(defineProps<{ conversation: Conversation | null; busy?: boolean }>(), {
  busy: false,
});

const emit = defineEmits<{ confirm: []; cancel: [] }>();

/**
 * The confirmation before a transcript is destroyed.
 *
 * It names the conversation. That is the entire reason this component exists
 * rather than a bare "Are you sure?": the delete is triggered from a row in a
 * list of near-identical rows, and the only way somebody can tell they clicked
 * the wrong one is if the dialog reads the title back to them.
 *
 * Deleting removes the messages too and the API offers no undo, so the copy
 * says so plainly and archiving is named as the softer option.
 */
const open = defineModel<boolean>('open', { required: true });

const title = computed(() => props.conversation?.title ?? 'this conversation');
</script>

<template>
  <ConfirmDialog
    v-model:open="open"
    title="Delete this conversation?"
    :message="`“${title}” and every message in it will be deleted permanently. Archive it instead if you only want it out of the list.`"
    confirm-label="Delete"
    :busy="busy"
    @confirm="emit('confirm')"
    @cancel="emit('cancel')"
  />
</template>
