<script setup lang="ts">
import type { AiUsageReport } from '@hadiya/shared';
import { computed, onMounted, ref } from 'vue';

import IntegrationCard from '@/components/settings/IntegrationCard.vue';
import UsagePanel from '@/components/settings/UsagePanel.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseCard from '@/components/ui/BaseCard.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import LoadingSkeleton from '@/components/ui/LoadingSkeleton.vue';
import { toErrorMessage } from '@/services/api-error';
import { integrationService, type BillzConnectionStatus } from '@/services/integration.service';
import type { AssistantStatus } from '@/services/chat.service';
import type { ImageProviderStatus } from '@/services/image.service';

/**
 * What Hadiya is connected to, and what it has spent.
 *
 * Everything here is read from the status endpoint each module already
 * publishes. None of them returns a credential — they report the *resolved*
 * provider, a host, a model — which is what makes this page safe to render at
 * all, and why there is no field on it to paste a key into: a secret belongs in
 * the deployment's environment, not in a form that would then have to store it.
 *
 * The four states are loaded independently and a failure in one does not blank
 * the others: "Billz is down" is exactly the moment somebody opens this page,
 * and it would be perverse for that to be the thing that hides the answer.
 */
const billz = ref<BillzConnectionStatus | null>(null);
const assistant = ref<AssistantStatus | null>(null);
const images = ref<ImageProviderStatus | null>(null);
const usage = ref<AiUsageReport | null>(null);

const isLoading = ref(true);
const error = ref<string | null>(null);

const ICONS = {
  billz: 'M3 3h2l3 12h10l3-8H7M9 21h.01M18 21h.01',
  assistant:
    'M12 3a9 9 0 0 0-9 9v5a3 3 0 0 0 3 3h1v-6H5v-2a7 7 0 1 1 14 0v2h-2v6h1a3 3 0 0 0 3-3v-5a9 9 0 0 0-9-9Z',
  images: 'M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6',
} as const;

/** Configured but unreachable is a different problem from never set up. */
const stateOf = (configured: boolean, healthy: boolean) =>
  !configured ? 'not-configured' : healthy ? 'connected' : 'failing';

const billzState = computed(() =>
  billz.value ? stateOf(billz.value.configured, billz.value.connected) : 'not-configured',
);

const assistantState = computed(() =>
  assistant.value
    ? stateOf(assistant.value.available, assistant.value.available)
    : 'not-configured',
);

const imagesState = computed(() =>
  images.value ? stateOf(images.value.available, images.value.available) : 'not-configured',
);

const toolCount = computed(() => assistant.value?.tools.length ?? 0);

const load = async (): Promise<void> => {
  isLoading.value = true;
  error.value = null;

  // Settled rather than all: one integration being down is the normal reason
  // to be on this page, and it must not blank the rest of it.
  const [billzResult, assistantResult, imagesResult, usageResult] = await Promise.allSettled([
    integrationService.billz(),
    integrationService.assistant(),
    integrationService.images(),
    integrationService.usage(),
  ]);

  billz.value = billzResult.status === 'fulfilled' ? billzResult.value : null;
  assistant.value = assistantResult.status === 'fulfilled' ? assistantResult.value : null;
  images.value = imagesResult.status === 'fulfilled' ? imagesResult.value : null;
  usage.value = usageResult.status === 'fulfilled' ? usageResult.value : null;

  // Only a total failure is worth an error state; a partial one is the content.
  if (usageResult.status === 'rejected' && billzResult.status === 'rejected') {
    error.value = toErrorMessage(usageResult.reason);
  }

  isLoading.value = false;
};

onMounted(load);
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-5">
    <div>
      <h2 class="text-xl font-semibold text-ink-900">Integrations</h2>
      <p class="mt-1 text-sm text-ink-500">What Hadiya is connected to, and what it has used.</p>
    </div>

    <LoadingSkeleton v-if="isLoading" variant="card" :rows="3" />

    <ErrorState v-else-if="error" :message="error" @retry="load" />

    <template v-else>
      <BaseCard title="Connections" description="Read from each service, just now">
        <div class="flex flex-col gap-3">
          <IntegrationCard
            name="Billz"
            description="The shop itself — catalogue, till, stock, customers. Hadiya reads it live."
            :state="billzState"
            :detail="billz?.baseUrl ?? null"
            :reason="billz?.error ?? null"
            :icon="ICONS.billz"
          />

          <IntegrationCard
            name="Assistant"
            description="The model that holds the conversation and picks the tools."
            :state="assistantState"
            :detail="assistant ? `${assistant.provider} · ${assistant.model ?? 'no model'}` : null"
            :reason="assistant?.reason ?? null"
            :icon="ICONS.assistant"
          >
            <p v-if="toolCount > 0" class="mt-1.5 text-xs text-ink-500">
              {{ toolCount }} tools available
            </p>
          </IntegrationCard>

          <IntegrationCard
            name="Image generation"
            description="Draws pictures for posts and banners."
            :state="imagesState"
            :detail="images ? `${images.provider} · ${images.model ?? 'no model'}` : null"
            :reason="images?.reason ?? null"
            :icon="ICONS.images"
          />
        </div>

        <p class="mt-3 text-xs text-ink-500">
          Credentials live in the deployment's environment and are never shown here or stored by
          this screen.
        </p>
      </BaseCard>

      <BaseCard title="Usage" description="Counted from what Hadiya actually sent and received">
        <UsagePanel v-if="usage" :usage="usage" />
        <p v-else class="text-sm text-ink-500">Usage could not be read.</p>

        <div
          class="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-3"
        >
          <p class="max-w-sm text-xs text-ink-500">
            Your remaining balance is not shown: the provider reveals it only to its own billing
            page, never to an API key.
          </p>
          <a
            href="https://platform.openai.com/settings/organization/billing/overview"
            target="_blank"
            rel="noopener noreferrer"
          >
            <BaseButton variant="secondary" size="sm">Open billing</BaseButton>
          </a>
        </div>
      </BaseCard>
    </template>
  </div>
</template>
