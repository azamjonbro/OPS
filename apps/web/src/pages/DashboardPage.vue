<script setup lang="ts">
import { APP_MODULES } from '@hadiya/shared';
import { computed, onMounted } from 'vue';

import UpcomingReminders from '@/components/reminders/UpcomingReminders.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseCard from '@/components/ui/BaseCard.vue';
import StatusPill from '@/components/ui/StatusPill.vue';
import { useAsyncTask } from '@/composables/useAsyncTask';
import { healthService } from '@/services/health.service';
import { formatDateTime, formatDuration } from '@/utils/format';

const health = useAsyncTask(healthService.fetch);

onMounted(() => {
  void health.run();
});

const status = computed(() => health.data.value?.status ?? 'unknown');
const dependencies = computed(() => health.data.value?.dependencies ?? []);

/** The delivered surface, so the roadmap below is never out of step with it. */
const implementedModules = new Set<string>(['reports', 'reminders', 'notifications', 'content']);
const roadmap = computed(() =>
  APP_MODULES.map((module) => ({ name: module, implemented: implementedModules.has(module) })),
);
</script>

<template>
  <div class="mx-auto flex max-w-5xl flex-col gap-6">
    <div>
      <h2 class="text-xl font-semibold text-ink-900">Foundation is live</h2>
      <p class="mt-1 text-sm text-ink-500">
        The API, the database connection and the application shell are running. Business modules are
        delivered in the phases that follow.
      </p>
    </div>

    <BaseCard title="API health" description="Read live from GET /api/health">
      <template #header>
        <div class="flex items-center gap-2">
          <StatusPill :status="status" />
          <BaseButton
            variant="secondary"
            size="sm"
            :loading="health.isLoading.value"
            @click="health.run()"
          >
            Refresh
          </BaseButton>
        </div>
      </template>

      <p v-if="health.error.value" class="text-sm text-rose-600">
        {{ health.error.value }}
      </p>

      <div v-else-if="health.data.value" class="flex flex-col gap-5">
        <dl class="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt class="text-xs uppercase tracking-wide text-ink-500">Service</dt>
            <dd class="mt-1 text-sm font-medium text-ink-900">{{ health.data.value.service }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-ink-500">Version</dt>
            <dd class="mt-1 text-sm font-medium text-ink-900">{{ health.data.value.version }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-ink-500">Environment</dt>
            <dd class="mt-1 text-sm font-medium text-ink-900">
              {{ health.data.value.environment }}
            </dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-ink-500">Uptime</dt>
            <dd class="mt-1 text-sm font-medium text-ink-900">
              {{ formatDuration(health.data.value.uptimeSeconds) }}
            </dd>
          </div>
        </dl>

        <ul class="divide-y divide-border-subtle rounded-lg ring-1 ring-border-subtle">
          <li
            v-for="dependency in dependencies"
            :key="dependency.name"
            class="flex items-center justify-between gap-4 px-4 py-3"
          >
            <div class="min-w-0">
              <p class="text-sm font-medium text-ink-900">{{ dependency.name }}</p>
              <p class="truncate text-xs text-ink-500">
                {{ dependency.detail ?? (dependency.required ? 'Required' : 'Optional') }}
              </p>
            </div>
            <div class="flex items-center gap-3">
              <span v-if="dependency.latencyMs !== undefined" class="text-xs text-ink-500">
                {{ dependency.latencyMs }} ms
              </span>
              <StatusPill :status="dependency.status" />
            </div>
          </li>
        </ul>

        <p class="text-xs text-ink-500">
          Checked {{ formatDateTime(health.data.value.timestamp) }}
        </p>
      </div>

      <p v-else class="text-sm text-ink-500">Loading…</p>
    </BaseCard>

    <UpcomingReminders />

    <BaseCard
      title="Module roadmap"
      description="Capabilities declared in the shared module registry"
    >
      <ul class="flex flex-wrap gap-2">
        <li
          v-for="entry in roadmap"
          :key="entry.name"
          class="rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset"
          :class="
            entry.implemented
              ? 'bg-brand-50 text-brand-700 ring-brand-200'
              : 'bg-surface-muted text-ink-500 ring-border-subtle'
          "
        >
          {{ entry.name }}
        </li>
      </ul>
    </BaseCard>
  </div>
</template>
