<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

/**
 * Where you are, and the way back up.
 *
 * Built from the route's own `breadcrumb` metadata rather than from the URL, so
 * a detail page can name the record it is showing instead of displaying an
 * object id. The last crumb carries `aria-current="page"` and is not a link,
 * because the page you are on is not somewhere to navigate to.
 */
const route = useRoute();

export interface Crumb {
  label: string;
  to?: { name: string };
}

const crumbs = computed<Crumb[]>(() => {
  const trail = route.meta.breadcrumb ?? [];
  const title = route.meta.title ?? '';

  return [...trail, ...(title ? [{ label: title }] : [])];
});
</script>

<template>
  <nav v-if="crumbs.length > 1" aria-label="Breadcrumb" class="min-w-0">
    <ol class="flex min-w-0 items-center gap-1.5 text-xs text-ink-500">
      <li v-for="(crumb, index) in crumbs" :key="`${crumb.label}-${index}`" class="flex items-center gap-1.5">
        <svg
          v-if="index > 0"
          class="size-3 shrink-0 text-ink-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
        <RouterLink
          v-if="crumb.to && index < crumbs.length - 1"
          :to="crumb.to"
          class="truncate hover:text-ink-900"
        >
          {{ crumb.label }}
        </RouterLink>
        <span v-else class="truncate" :aria-current="index === crumbs.length - 1 ? 'page' : undefined">
          {{ crumb.label }}
        </span>
      </li>
    </ol>
  </nav>
</template>
