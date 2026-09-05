<script setup lang="ts">
import type { IntegrationStatus } from '@hadiya/shared';
import { computed } from 'vue';

import BaseBadge from '@/components/ui/BaseBadge.vue';

/**
 * Where an integration stands, in one chip.
 *
 * Five states rather than a green or red dot, because the actions they call for
 * are completely different: a disconnected integration needs connecting, a
 * failing one needs looking at, and a switched-off one needs nothing at all. A
 * single indicator for all three sends people hunting in the wrong place.
 */
const props = defineProps<{ status: IntegrationStatus; enabled?: boolean }>();

const TONES = {
  connected: 'positive',
  connecting: 'brand',
  disconnected: 'neutral',
  error: 'danger',
  disabled: 'neutral',
} as const;

const LABELS = {
  connected: 'Connected',
  connecting: 'Connecting…',
  disconnected: 'Not connected',
  error: 'Failed',
  disabled: 'Switched off',
} as const;

// A person's switch wins over the connection state: an integration somebody
// turned off should say so, whatever the server would answer.
const effective = computed<IntegrationStatus>(() =>
  props.enabled === false ? 'disabled' : props.status,
);
</script>

<template>
  <BaseBadge :tone="TONES[effective]" dot>{{ LABELS[effective] }}</BaseBadge>
</template>
