<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import BaseButton from '@/components/ui/BaseButton.vue';
import { toErrorMessage } from '@/services/api-error';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const credentials = reactive({ username: '', password: '' });
const errorMessage = ref<string | null>(null);
const isSubmitting = ref(false);

const onSubmit = async (): Promise<void> => {
  isSubmitting.value = true;
  errorMessage.value = null;

  try {
    await auth.login({ username: credentials.username, password: credentials.password });

    const redirect = route.query.redirect;
    await router.push(typeof redirect === 'string' ? redirect : { name: 'assistant' });
  } catch (error) {
    errorMessage.value = toErrorMessage(error, 'Unable to sign in');
  } finally {
    isSubmitting.value = false;
  }
};
</script>

<template>
  <form class="rounded-xl bg-white p-6 ring-1 ring-border-subtle" @submit.prevent="onSubmit">
    <h1 class="text-lg font-semibold text-ink-900">Sign in</h1>
    <p class="mt-1 text-sm text-ink-500">Use your Hadiya account credentials.</p>

    <div class="mt-6 flex flex-col gap-4">
      <div>
        <label for="username" class="block text-sm font-medium text-ink-700">Username</label>
        <input
          id="username"
          v-model.trim="credentials.username"
          name="username"
          type="text"
          autocomplete="username"
          required
          class="mt-1.5 h-10 w-full rounded-lg border-0 px-3 text-sm ring-1 ring-inset ring-border-subtle focus:ring-2 focus:ring-brand-500"
        />
      </div>

      <div>
        <label for="password" class="block text-sm font-medium text-ink-700">Password</label>
        <input
          id="password"
          v-model="credentials.password"
          name="password"
          type="password"
          autocomplete="current-password"
          required
          class="mt-1.5 h-10 w-full rounded-lg border-0 px-3 text-sm ring-1 ring-inset ring-border-subtle focus:ring-2 focus:ring-brand-500"
        />
      </div>

      <p v-if="errorMessage" class="text-sm text-rose-600">{{ errorMessage }}</p>

      <BaseButton type="submit" block :loading="isSubmitting">Sign in</BaseButton>
    </div>

  </form>
</template>
