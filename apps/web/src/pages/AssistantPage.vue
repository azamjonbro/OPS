<script setup lang="ts">
import { onMounted, ref } from 'vue';

import BaseBadge from '@/components/ui/BaseBadge.vue';
import BaseCard from '@/components/ui/BaseCard.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import { api } from '@/services/http';

/**
 * The assistant's home, before the conversation interface exists.
 *
 * Deliberately a shell rather than a half-built chat. It occupies the route,
 * reports what the assistant can currently do, and gives Phase 10 a place to
 * mount a transcript and a composer without moving anything: the route, the
 * navigation entry and the layout are already settled, so the next phase adds
 * components rather than restructuring the application.
 */
interface AssistantStatus {
  provider: string;
  available: boolean;
  model: string | null;
  reason: string | null;
  tools: Array<{ name: string; description: string; mutates: boolean }>;
}

const status = ref<AssistantStatus | null>(null);
const isLoading = ref(true);

onMounted(async () => {
  try {
    status.value = await api.get<AssistantStatus>('/v1/ai/status');
  } catch {
    status.value = null;
  } finally {
    isLoading.value = false;
  }
});
</script>

<template>
  <div class="mx-auto flex max-w-3xl flex-col gap-5">
    <div>
      <h2 class="text-xl font-semibold text-ink-900">Assistant</h2>
      <p class="mt-1 text-sm text-ink-500">
        The assistant already works through the API. The conversation interface arrives in the next
        phase.
      </p>
    </div>

    <!-- Where the transcript and composer will mount. -->
    <BaseCard title="Chat" description="Coming in the next phase">
      <EmptyState
        title="The conversation interface is not built yet"
        description="Everything behind it is: conversations, memory, tools for reminders, content, images and the shop's own figures."
        icon="M12 3a9 9 0 0 0-9 9v5a3 3 0 0 0 3 3h1v-6H5v-2a7 7 0 1 1 14 0v2h-2v6h1a3 3 0 0 0 3-3v-5a9 9 0 0 0-9-9Z"
      />
    </BaseCard>

    <BaseCard title="What it can do" description="Tools registered on the server right now">
      <p v-if="isLoading" class="text-sm text-ink-500">Checking…</p>

      <template v-else-if="status">
        <div class="mb-3 flex items-center gap-2">
          <BaseBadge :tone="status.available ? 'positive' : 'warning'" dot>
            {{ status.available ? `${status.provider} · ${status.model}` : 'Not configured' }}
          </BaseBadge>
          <span v-if="status.reason" class="text-xs text-ink-500">{{ status.reason }}</span>
        </div>

        <ul class="flex flex-wrap gap-1.5">
          <li v-for="tool in status.tools" :key="tool.name">
            <BaseBadge :tone="tool.mutates ? 'brand' : 'neutral'">{{ tool.name }}</BaseBadge>
          </li>
        </ul>
      </template>

      <p v-else class="text-sm text-ink-500">The assistant status could not be read.</p>
    </BaseCard>
  </div>
</template>
