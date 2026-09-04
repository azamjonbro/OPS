<script setup lang="ts">
import { CONTENT_PLATFORMS, type ContentPlatform } from '@hadiya/shared';
import { onMounted, reactive, ref } from 'vue';

import BaseButton from '@/components/ui/BaseButton.vue';
import BaseCard from '@/components/ui/BaseCard.vue';
import { useContentStore } from '@/stores/content';
import { formatDateTime } from '@/utils/format';

/**
 * The plan list, plus the two ways to start one: describe it and have it
 * written, or create an empty plan and fill in the days yourself.
 */
const content = useContentStore();

const brief = reactive({
  text: '',
  platform: 'instagram' as ContentPlatform,
  days: 7,
});
const manual = reactive({ title: '', platform: 'instagram' as ContentPlatform, startDate: '' });
const showManual = ref(false);
const notice = ref<string | null>(null);

onMounted(() => {
  void content.loadPlans();
});

const generate = async (): Promise<void> => {
  notice.value = null;

  const plan = await content.generatePlan({
    brief: brief.text,
    platform: brief.platform,
    days: brief.days,
  });

  if (plan) {
    notice.value = `Saved "${plan.title}" with ${plan.itemCount} day(s).`;
    brief.text = '';
  }
};

const createManually = async (): Promise<void> => {
  notice.value = null;

  const plan = await content.createPlan({
    title: manual.title,
    platform: manual.platform,
    startDate: manual.startDate,
  });

  if (plan) {
    notice.value = `Created "${plan.title}". Add days from the plan page.`;
    manual.title = '';
    manual.startDate = '';
    showManual.value = false;
  }
};

const fieldClasses =
  'h-10 w-full rounded-lg px-3 text-sm text-ink-900 ring-1 ring-inset ring-border-subtle focus:outline-none focus:ring-2 focus:ring-brand-600';
</script>

<template>
  <div class="mx-auto flex max-w-5xl flex-col gap-6">
    <div>
      <h2 class="text-xl font-semibold text-ink-900">Content plans</h2>
      <p class="mt-1 text-sm text-ink-500">
        Describe what you need and the assistant writes it — or ask it in chat: “Hadiya uchun 7
        kunlik Instagram content plan tuz.”
      </p>
    </div>

    <BaseCard title="New plan" description="Written for you, in your language and tone">
      <form class="flex flex-col gap-4" @submit.prevent="generate">
        <label class="flex flex-col gap-1">
          <span class="text-xs font-medium uppercase tracking-wide text-ink-500">Brief</span>
          <input
            v-model="brief.text"
            required
            minlength="3"
            maxlength="1000"
            :class="fieldClasses"
            placeholder="Hadiya uchun 7 kunlik Instagram plan"
          />
        </label>

        <div class="grid gap-4 sm:grid-cols-3">
          <label class="flex flex-col gap-1">
            <span class="text-xs font-medium uppercase tracking-wide text-ink-500">Platform</span>
            <select v-model="brief.platform" :class="fieldClasses">
              <option v-for="platform in CONTENT_PLATFORMS" :key="platform" :value="platform">
                {{ platform }}
              </option>
            </select>
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-xs font-medium uppercase tracking-wide text-ink-500">Days</span>
            <input
              v-model.number="brief.days"
              type="number"
              min="1"
              max="60"
              :class="fieldClasses"
            />
          </label>
          <div class="flex items-end">
            <BaseButton type="submit" block :loading="content.isGenerating">
              {{ content.isGenerating ? 'Writing…' : 'Generate plan' }}
            </BaseButton>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <BaseButton variant="ghost" size="sm" @click="showManual = !showManual">
            {{ showManual ? 'Hide' : 'Create an empty plan instead' }}
          </BaseButton>
          <p v-if="notice" class="text-sm text-emerald-600">{{ notice }}</p>
          <p v-else-if="content.error" class="text-sm text-rose-600">{{ content.error }}</p>
        </div>
      </form>

      <form
        v-if="showManual"
        class="mt-4 grid gap-4 border-t border-border-subtle pt-4 sm:grid-cols-4"
        @submit.prevent="createManually"
      >
        <label class="flex flex-col gap-1 sm:col-span-2">
          <span class="text-xs font-medium uppercase tracking-wide text-ink-500">Title</span>
          <input v-model="manual.title" required maxlength="160" :class="fieldClasses" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-xs font-medium uppercase tracking-wide text-ink-500">Starts</span>
          <input v-model="manual.startDate" type="date" required :class="fieldClasses" />
        </label>
        <div class="flex items-end">
          <BaseButton type="submit" block variant="secondary" :loading="content.isSaving">
            Create
          </BaseButton>
        </div>
      </form>
    </BaseCard>

    <BaseCard title="Your plans" description="Most recent first">
      <template #header>
        <BaseButton
          variant="secondary"
          size="sm"
          :loading="content.isLoading"
          @click="content.loadPlans()"
        >
          Refresh
        </BaseButton>
      </template>

      <p v-if="content.isLoading && !content.hasPlans" class="text-sm text-ink-500">Loading…</p>

      <p v-else-if="!content.hasPlans" class="text-sm text-ink-500">No content plans yet.</p>

      <ul v-else class="divide-y divide-border-subtle rounded-lg ring-1 ring-border-subtle">
        <li
          v-for="plan in content.plans"
          :key="plan.id"
          class="flex items-center justify-between gap-4 px-4 py-3"
        >
          <div class="min-w-0">
            <RouterLink
              :to="{ name: 'content-plan', params: { id: plan.id } }"
              class="truncate text-sm font-medium text-ink-900 hover:text-brand-700"
            >
              {{ plan.title }}
            </RouterLink>
            <p class="mt-0.5 text-xs text-ink-500">
              {{ plan.platform }} · {{ plan.itemCount }} day(s) ·
              {{ plan.startDate.slice(0, 10) }} → {{ plan.endDate.slice(0, 10) }} ·
              {{ plan.status }}
            </p>
          </div>
          <span class="shrink-0 text-xs text-ink-500">{{ formatDateTime(plan.createdAt) }}</span>
        </li>
      </ul>
    </BaseCard>
  </div>
</template>
