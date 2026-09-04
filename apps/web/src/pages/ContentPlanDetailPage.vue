<script setup lang="ts">
import { CONTENT_TYPES, type ContentType } from '@hadiya/shared';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import ContentItemCard from '@/components/content/ContentItemCard.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseCard from '@/components/ui/BaseCard.vue';
import { useContentStore } from '@/stores/content';

/**
 * One plan and its days.
 *
 * Deleting the plan asks first, on screen, for the same reason the assistant's
 * tool does: the items go with it and nothing brings them back.
 */
const route = useRoute();
const router = useRouter();
const content = useContentStore();

const planId = computed(() => String(route.params.id ?? ''));
const isConfirmingDelete = ref(false);
const showAddForm = ref(false);
const newItem = reactive({
  date: '',
  contentType: 'post' as ContentType,
  title: '',
  idea: '',
  caption: '',
});

const load = (): void => {
  if (planId.value) {
    void content.loadPlan(planId.value);
  }
};

onMounted(load);
watch(planId, load);

const addItem = async (): Promise<void> => {
  await content.addItem(planId.value, {
    date: newItem.date,
    contentType: newItem.contentType,
    title: newItem.title,
    idea: newItem.idea,
    caption: newItem.caption || null,
  });

  if (!content.error) {
    Object.assign(newItem, { date: '', title: '', idea: '', caption: '' });
    showAddForm.value = false;
  }
};

const removePlan = async (): Promise<void> => {
  await content.deletePlan(planId.value);

  if (!content.error) {
    await router.push({ name: 'content-plans' });
  }
};

const fieldClasses =
  'h-10 w-full rounded-lg px-3 text-sm text-ink-900 ring-1 ring-inset ring-border-subtle focus:outline-none focus:ring-2 focus:ring-brand-600';
</script>

<template>
  <div class="mx-auto flex max-w-4xl flex-col gap-6">
    <RouterLink :to="{ name: 'content-plans' }" class="text-sm text-ink-500 hover:text-ink-900">
      ← All plans
    </RouterLink>

    <p v-if="content.error" class="text-sm text-rose-600">{{ content.error }}</p>

    <p v-if="content.isLoading && !content.plan" class="text-sm text-ink-500">Loading…</p>

    <template v-else-if="content.plan">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h2 class="text-xl font-semibold text-ink-900">{{ content.plan.title }}</h2>
          <p class="mt-1 text-sm text-ink-500">
            {{ content.plan.platform }} · {{ content.plan.itemCount }} day(s) ·
            {{ content.plan.startDate.slice(0, 10) }} → {{ content.plan.endDate.slice(0, 10) }}
          </p>
          <p v-if="content.plan.description" class="mt-1 text-sm text-ink-500">
            {{ content.plan.description }}
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <template v-if="isConfirmingDelete">
            <span class="text-xs text-ink-500">Delete the plan and its days?</span>
            <BaseButton
              size="sm"
              variant="secondary"
              :loading="content.isSaving"
              @click="removePlan"
            >
              Yes, delete
            </BaseButton>
            <BaseButton size="sm" variant="ghost" @click="isConfirmingDelete = false">
              Cancel
            </BaseButton>
          </template>
          <BaseButton v-else size="sm" variant="ghost" @click="isConfirmingDelete = true">
            Delete plan
          </BaseButton>
        </div>
      </div>

      <BaseCard title="Days" :description="`${content.items.length} scheduled`">
        <template #header>
          <BaseButton variant="secondary" size="sm" @click="showAddForm = !showAddForm">
            {{ showAddForm ? 'Cancel' : 'Add a day' }}
          </BaseButton>
        </template>

        <form
          v-if="showAddForm"
          class="mb-4 grid gap-3 border-b border-border-subtle pb-4 sm:grid-cols-2"
          @submit.prevent="addItem"
        >
          <label class="flex flex-col gap-1">
            <span class="text-xs font-medium uppercase tracking-wide text-ink-500">Date</span>
            <input v-model="newItem.date" type="date" required :class="fieldClasses" />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-xs font-medium uppercase tracking-wide text-ink-500">Type</span>
            <select v-model="newItem.contentType" :class="fieldClasses">
              <option v-for="type in CONTENT_TYPES" :key="type" :value="type">{{ type }}</option>
            </select>
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-xs font-medium uppercase tracking-wide text-ink-500">Title</span>
            <input v-model="newItem.title" required maxlength="200" :class="fieldClasses" />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-xs font-medium uppercase tracking-wide text-ink-500">Idea</span>
            <input v-model="newItem.idea" required maxlength="2000" :class="fieldClasses" />
          </label>
          <label class="flex flex-col gap-1 sm:col-span-2">
            <span class="text-xs font-medium uppercase tracking-wide text-ink-500">
              Caption (optional)
            </span>
            <input v-model="newItem.caption" maxlength="4000" :class="fieldClasses" />
          </label>
          <div class="sm:col-span-2">
            <BaseButton type="submit" :loading="content.isSaving">Add day</BaseButton>
          </div>
        </form>

        <p v-if="content.items.length === 0" class="text-sm text-ink-500">
          No days yet. Add one, or ask the assistant to write them.
        </p>

        <ul v-else class="divide-y divide-border-subtle rounded-lg ring-1 ring-border-subtle">
          <ContentItemCard
            v-for="item in content.items"
            :key="item.id"
            :item="item"
            :busy="content.isSaving || content.isGenerating"
            @save="(id, changes) => content.updateItem(id, changes)"
            @regenerate="(id, instruction) => content.regenerateItem(id, instruction)"
            @remove="(id) => content.deleteItem(id)"
          />
        </ul>
      </BaseCard>
    </template>

    <p v-else class="text-sm text-ink-500">This plan could not be found.</p>
  </div>
</template>
