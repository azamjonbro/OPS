<script setup lang="ts">
import { useUiStore } from '@/stores/ui';

/**
 * The chat's own shell: a sidebar, a header, a scrolling transcript and a
 * composer pinned to the bottom.
 *
 * Deliberately not `AppLayout`. That layout gives its main area
 * `overflow-y-auto` and lets the page grow — exactly wrong for a conversation,
 * where only the transcript may scroll and the composer must stay reachable.
 * Nesting one inside the other produces the double scrollbar every
 * chat-in-a-dashboard has, and on a phone it pushes the input under the
 * keyboard.
 *
 * So the frame is `h-full` with a single flex column and `min-h-0` on every
 * child, which is what confines the scrolling to the transcript's own box.
 *
 * It is a component with slots rather than a routed layout because the sidebar
 * and the transcript have to talk to each other — opening a thread, deleting
 * one — and two sibling `RouterView`s cannot.
 *
 * From `lg` up the sidebar is part of the layout; below that it is an
 * off-canvas drawer over a scrim, driven by the same `ui` flag the rest of the
 * application uses so one store decides whether a drawer is open.
 */
const ui = useUiStore();
</script>

<template>
  <div class="flex h-full min-h-0">
    <a
      href="#chat-main"
      class="sr-only-focusable absolute left-4 top-4 z-[70] rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white"
    >
      Skip to the conversation
    </a>

    <div class="hidden lg:block">
      <slot name="sidebar" />
    </div>

    <div v-if="ui.mobileSidebarOpen" class="fixed inset-0 z-40 lg:hidden">
      <div
        class="absolute inset-0 bg-slate-900/50"
        aria-hidden="true"
        @click="ui.toggleMobileSidebar(false)"
      />
      <div class="absolute inset-y-0 left-0 shadow-xl">
        <slot name="sidebar" />
      </div>
    </div>

    <div class="flex min-h-0 min-w-0 flex-1 flex-col bg-surface relative">
      <slot name="header" />

      <main id="chat-main" class="flex min-h-0 flex-1 flex-col relative" tabindex="-1">
        <slot />
      </main>

      <slot name="composer" />
    </div>
  </div>
</template>
