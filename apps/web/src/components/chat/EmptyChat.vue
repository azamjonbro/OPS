<script setup lang="ts">
const emit = defineEmits<{ pick: [text: string] }>();

/**
 * A conversation nobody has said anything in yet.
 *
 * The suggestions are not features: each is an ordinary sentence that goes to
 * the same endpoint as anything else somebody types. They exist because a blank
 * box does not tell a shopkeeper that they can ask about yesterday's takings in
 * the same breath as asking for a poster — and that breadth is the whole point
 * of the product.
 */
const SUGGESTIONS = [
  'Bugungi savdoni tahlil qil',
  'Eng ko‘p sotilgan mahsulotlar qaysi?',
  '7 kunlik Instagram kontent reja tuz',
  'Ertaga soat 10:00 da omborni tekshirishni eslat',
] as const;
</script>

<template>
  <div class="mx-auto flex w-full max-w-2xl flex-col items-center gap-6 px-4 py-10 text-center">
    <span
      class="grid size-14 place-items-center rounded-2xl bg-brand-600 text-lg font-bold text-white"
      aria-hidden="true"
    >
      H
    </span>

    <div>
      <h2 class="text-lg font-semibold text-ink-900">Hadiya bilan suhbat</h2>
      <p class="mt-1.5 max-w-md text-sm text-ink-500">
        Ask about the shop's figures, plan content, create images, or set a reminder — in your own
        words.
      </p>
    </div>

    <ul class="grid w-full gap-2 sm:grid-cols-2">
      <li v-for="suggestion in SUGGESTIONS" :key="suggestion">
        <button
          type="button"
          class="w-full rounded-xl bg-surface px-3.5 py-3 text-left text-sm text-ink-700 ring-1 ring-border-subtle transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-brand-600"
          @click="emit('pick', suggestion)"
        >
          {{ suggestion }}
        </button>
      </li>
    </ul>
  </div>
</template>
