<script setup lang="ts">
const emit = defineEmits<{ pick: [text: string] }>();

const SUGGESTIONS = [
  { 
    title: 'Analyze Sales',
    text: 'Bugungi savdoni tahlil qil',
    icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z'
  },
  { 
    title: 'Top Products',
    text: 'Eng ko‘p sotilgan mahsulotlar qaysi?',
    icon: 'M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z'
  },
  { 
    title: 'Plan Content',
    text: '7 kunlik Instagram kontent reja tuz',
    icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z'
  },
  { 
    title: 'Set Reminder',
    text: 'Ertaga soat 10:00 da omborni tekshirishni eslat',
    icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z'
  }
] as const;
</script>

<template>
  <div class="mx-auto flex w-full max-w-3xl flex-col items-center justify-center gap-8 px-4 py-20 min-h-[60vh]">
    <div class="flex flex-col items-center gap-5 text-center">
      <span
        class="grid size-[72px] place-items-center rounded-2xl bg-brand-500 text-3xl font-bold text-white shadow-xl shadow-brand-500/20 ring-4 ring-brand-50 dark:ring-surface-raised"
        aria-hidden="true"
      >
        H
      </span>

      <div>
        <h2 class="text-2xl font-semibold tracking-tight text-ink-900">How can I help your business today?</h2>
        <p class="mt-2 max-w-md text-[15px] text-ink-500 mx-auto leading-relaxed">
          Ask about the shop's figures, plan content, create images, or set a reminder.
        </p>
      </div>
    </div>

    <ul class="grid w-full gap-3 sm:grid-cols-2 mt-4">
      <li v-for="suggestion in SUGGESTIONS" :key="suggestion.text">
        <button
          type="button"
          class="group flex w-full flex-col gap-2 rounded-[14px] bg-surface p-4 text-left shadow-sm ring-1 ring-border-subtle transition-all duration-200 hover:bg-surface-muted hover:shadow-md hover:ring-brand-500/50 focus:outline-none focus:ring-2 focus:ring-brand-500"
          @click="emit('pick', suggestion.text)"
        >
          <div class="flex items-center gap-2.5">
            <div class="grid size-7 shrink-0 place-items-center rounded-lg bg-surface-raised text-ink-500 transition-colors group-hover:bg-brand-50 group-hover:text-brand-600 dark:group-hover:bg-brand-500/20 dark:group-hover:text-brand-400">
              <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" :d="suggestion.icon" />
              </svg>
            </div>
            <span class="text-[14px] font-semibold text-ink-900">{{ suggestion.title }}</span>
          </div>
          <span class="text-[13px] text-ink-500 truncate w-full">{{ suggestion.text }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>
