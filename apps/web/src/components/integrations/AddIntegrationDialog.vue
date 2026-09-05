<script setup lang="ts">
import { MCP_TRANSPORTS, type IntegrationProviderInfo, type McpAuthMethod } from '@hadiya/shared';
import { computed, reactive, ref, watch } from 'vue';

import BaseButton from '@/components/ui/BaseButton.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import { PROVIDER_ICONS, PROVIDER_TINTS } from './provider-marks';
import type { CreateIntegrationPayload } from '@/services/integration.service';

/**
 * Choosing what to connect, then saying how.
 *
 * Two steps rather than one long form, because the second step is different for
 * every provider and showing all of them at once would ask a person to ignore
 * most of the screen. Billz needs nothing; Notion needs a token; an MCP server
 * needs an address and possibly a token.
 *
 * The options come from the server's catalogue rather than from a list in this
 * file, which is what keeps the screen honest: an auth method appears here only
 * if something implements it, and a provider the deployment cannot support
 * arrives already marked unavailable with the reason attached.
 */
const props = defineProps<{ catalogue: IntegrationProviderInfo[]; busy?: boolean }>();
const emit = defineEmits<{ submit: [payload: CreateIntegrationPayload] }>();

const open = defineModel<boolean>('open', { required: true });

const chosen = ref<IntegrationProviderInfo | null>(null);

const form = reactive({
  name: '',
  description: '',
  serverUrl: '',
  transport: 'http' as (typeof MCP_TRANSPORTS)[number],
  authMethod: 'none' as McpAuthMethod,
  authHeaderName: '',
  secret: '',
});

/** Every dialog opening starts clean; a token must not survive a cancel. */
watch(open, (isOpen) => {
  if (!isOpen) {
    return;
  }

  chosen.value = null;
  Object.assign(form, {
    name: '',
    description: '',
    serverUrl: '',
    transport: 'http',
    authMethod: 'none',
    authHeaderName: '',
    secret: '',
  });
});

const needsSecret = computed(() => {
  if (!chosen.value) {
    return false;
  }

  return chosen.value.requiresCredential || form.authMethod !== 'none';
});

const canSubmit = computed(() => {
  if (!chosen.value || form.name.trim().length === 0) {
    return false;
  }

  if (chosen.value.requiresServerUrl && form.serverUrl.trim().length === 0) {
    return false;
  }

  if (needsSecret.value && form.secret.trim().length === 0) {
    return false;
  }

  return !(form.authMethod === 'header' && form.authHeaderName.trim().length === 0);
});

const choose = (provider: IntegrationProviderInfo): void => {
  if (!provider.available) {
    return;
  }

  chosen.value = provider;
  form.name = provider.label;
  // The catalogue's own list, so the browser cannot offer a method the server
  // would refuse — and cannot offer OAuth, which nothing implements.
  //
  // `bearer` is preferred over the first entry, which is `none`. Defaulting to
  // "no authentication" hid the token field behind a dropdown nobody had a
  // reason to open, so the form asked for a name and a URL and looked complete
  // while missing the one thing most servers actually require.
  form.authMethod = provider.authMethods.includes('bearer')
    ? 'bearer'
    : (provider.authMethods[0] ?? 'none');
};

const submit = (): void => {
  const provider = chosen.value;

  if (!provider || !canSubmit.value) {
    return;
  }

  emit('submit', {
    provider: provider.provider,
    name: form.name.trim(),
    ...(form.description.trim() ? { description: form.description.trim() } : {}),
    ...(provider.requiresServerUrl ? { serverUrl: form.serverUrl.trim() } : {}),
    ...(provider.requiresServerUrl ? { transport: form.transport } : {}),
    ...(provider.authMethods.length > 0 ? { authMethod: form.authMethod } : {}),
    ...(form.authMethod === 'header' ? { authHeaderName: form.authHeaderName.trim() } : {}),
    ...(needsSecret.value ? { secret: form.secret } : {}),
  });
};

const fieldClasses =
  'h-10 w-full rounded-lg bg-surface px-3 text-sm text-ink-900 ring-1 ring-inset ring-border-subtle focus:outline-none focus:ring-2 focus:ring-brand-600';

const TRANSPORT_LABELS = {
  http: 'Streamable HTTP (recommended)',
  sse: 'Server-sent events (older servers)',
} as const;

const AUTH_LABELS: Record<McpAuthMethod, string> = {
  none: 'None',
  bearer: 'Bearer token',
  header: 'Custom header',
};
</script>

<template>
  <BaseModal
    v-model:open="open"
    title="Add integration"
    :description="chosen ? chosen.description : 'Choose what Hadiya should connect to.'"
  >
    <!-- Step one: what. -->
    <div v-if="!chosen" class="flex flex-col gap-2">
      <button
        v-for="provider in props.catalogue"
        :key="provider.provider"
        type="button"
        class="flex items-start gap-3 rounded-xl p-3 text-left ring-1 ring-border-subtle transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
        :disabled="!provider.available"
        @click="choose(provider)"
      >
        <span
          class="grid size-9 shrink-0 place-items-center rounded-lg"
          :class="PROVIDER_TINTS[provider.provider]"
          aria-hidden="true"
        >
          <svg
            class="size-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path :d="PROVIDER_ICONS[provider.provider]" />
          </svg>
        </span>

        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-ink-900">{{ provider.label }}</span>
          <span class="mt-0.5 block text-xs text-ink-500">{{ provider.description }}</span>
          <!--
            What it will ask for, before it is picked. Knowing you need a token
            is the difference between starting this and abandoning it halfway.
          -->
          <span v-if="provider.available" class="mt-1 block text-xs text-ink-700">
            {{ provider.setupHint }}
          </span>
          <span
            v-if="!provider.available && provider.unavailableReason"
            class="mt-1 block text-xs text-warning-700"
          >
            {{ provider.unavailableReason }}
          </span>
        </span>
      </button>
    </div>

    <!-- Step two: how. -->
    <form v-else class="flex flex-col gap-4" @submit.prevent="submit">
      <p class="rounded-lg bg-surface-muted px-3 py-2 text-xs text-ink-700">
        {{ chosen.setupHint }}
      </p>

      <label class="flex flex-col gap-1">
        <span class="text-xs font-medium uppercase tracking-wide text-ink-500">Name</span>
        <input v-model="form.name" required maxlength="80" :class="fieldClasses" />
      </label>

      <label class="flex flex-col gap-1">
        <span class="text-xs font-medium uppercase tracking-wide text-ink-500">
          Description <span class="normal-case text-ink-400">(optional)</span>
        </span>
        <input
          v-model="form.description"
          maxlength="200"
          :class="fieldClasses"
          placeholder="What this is for"
        />
      </label>

      <template v-if="chosen.requiresServerUrl">
        <label class="flex flex-col gap-1">
          <span class="text-xs font-medium uppercase tracking-wide text-ink-500">Server URL</span>
          <input
            v-model="form.serverUrl"
            required
            type="url"
            :class="fieldClasses"
            placeholder="https://crm.example.com/mcp"
          />
          <span class="text-xs text-ink-500">
            Must be https, and must not be an address inside a private network.
          </span>
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-xs font-medium uppercase tracking-wide text-ink-500">Transport</span>
          <select v-model="form.transport" :class="fieldClasses">
            <option v-for="transport in MCP_TRANSPORTS" :key="transport" :value="transport">
              {{ TRANSPORT_LABELS[transport] }}
            </option>
          </select>
        </label>
      </template>

      <label v-if="chosen.authMethods.length > 0" class="flex flex-col gap-1">
        <span class="text-xs font-medium uppercase tracking-wide text-ink-500">
          Authentication
        </span>
        <select v-model="form.authMethod" :class="fieldClasses">
          <option v-for="method in chosen.authMethods" :key="method" :value="method">
            {{ AUTH_LABELS[method] }}
          </option>
        </select>
      </label>

      <label v-if="form.authMethod === 'header'" class="flex flex-col gap-1">
        <span class="text-xs font-medium uppercase tracking-wide text-ink-500">Header name</span>
        <input
          v-model="form.authHeaderName"
          required
          maxlength="64"
          :class="fieldClasses"
          placeholder="X-Api-Key"
        />
      </label>

      <label v-if="needsSecret" class="flex flex-col gap-1">
        <span class="text-xs font-medium uppercase tracking-wide text-ink-500">Token</span>
        <!--
          `type="password"`, autocomplete off: a token is not a password the
          browser should offer to remember, and it is never sent back to this
          screen — once saved it can be replaced but not read.
        -->
        <input
          v-model="form.secret"
          required
          type="password"
          autocomplete="off"
          :class="fieldClasses"
          placeholder="••••••••"
        />
        <span class="text-xs text-ink-500">
          Stored encrypted. Hadiya never shows it again and never sends it anywhere but the service
          it belongs to.
        </span>
      </label>
    </form>

    <template #footer>
      <BaseButton v-if="chosen" variant="ghost" :disabled="busy" @click="chosen = null">
        Back
      </BaseButton>
      <BaseButton v-else variant="ghost" @click="open = false">Cancel</BaseButton>

      <BaseButton v-if="chosen" :loading="busy" :disabled="!canSubmit" @click="submit">
        Add integration
      </BaseButton>
    </template>
  </BaseModal>
</template>
