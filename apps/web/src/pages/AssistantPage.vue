<script setup lang="ts">
import type { Conversation } from '@hadiya/shared';
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import AgentActivity from '@/components/chat/AgentActivity.vue';
import ChatError from '@/components/chat/ChatError.vue';
import ChatHeader from '@/components/chat/ChatHeader.vue';
import ConversationSidebar from '@/components/chat/ConversationSidebar.vue';
import DeleteConversationDialog from '@/components/chat/DeleteConversationDialog.vue';
import EmptyChat from '@/components/chat/EmptyChat.vue';
import MemoryNotice from '@/components/chat/MemoryNotice.vue';
import MessageComposer from '@/components/chat/MessageComposer.vue';
import MessageList from '@/components/chat/MessageList.vue';
import PendingActionCard from '@/components/chat/PendingActionCard.vue';
import StreamingAnswer from '@/components/chat/StreamingAnswer.vue';
import ChatLayout from '@/layouts/ChatLayout.vue';
import { useToast } from '@/composables/useToast';
import { toErrorMessage } from '@/services/api-error';
import { chatService } from '@/services/chat.service';
import { useChatStore } from '@/stores/chat';
import { useConversationsStore } from '@/stores/conversations';
import { useUiStore } from '@/stores/ui';

/**
 * Hadiya, as a person uses it.
 *
 * The page owns the two things that need to know about each other — the thread
 * list and the open thread — and delegates everything else. It holds no chat
 * logic of its own: sending, paging and error handling all live in the store,
 * and *what* an answer looks like is decided by the message renderer.
 *
 * The conversation id lives in the URL, so a thread can be linked, bookmarked
 * and reopened by the back button. It is never trusted: the API scopes every
 * read to the signed-in employee and answers "not found" for somebody else's
 * thread, which this page shows as an ordinary error.
 */
const route = useRoute();
const router = useRouter();
const toast = useToast();
const ui = useUiStore();
const chat = useChatStore();
const conversations = useConversationsStore();

const composer = ref<InstanceType<typeof MessageComposer> | null>(null);
const pendingDelete = ref<Conversation | null>(null);
const isDeleting = ref(false);
const isDeleteOpen = ref(false);
const memoryBusyId = ref<string | null>(null);

/**
 * Whether the assistant can answer at all.
 *
 * Read once on mount from the status endpoint. It reports the resolved provider
 * and never a key, so there is nothing here to leak; a missing answer is
 * treated as "available" rather than blocking the interface on a status check.
 */
const isConnected = ref(true);

const routeId = computed(() => {
  const id = route.params.id;

  return typeof id === 'string' && id.length > 0 ? id : null;
});

const openRouteConversation = async (id: string | null): Promise<void> => {
  if (!id) {
    chat.startNew();

    return;
  }

  await chat.open(id);
  // A turn may still be running from before this page was loaded — another tab,
  // or this one before a refresh. The server is asked rather than guessed at,
  // and a run that has already finished is simply not there to rejoin.
  void chat.resumeActiveRun(id);
};

watch(routeId, (id) => void openRouteConversation(id));

onMounted(async () => {
  await openRouteConversation(routeId.value);

  try {
    const status = await chatService.status();
    isConnected.value = status.available;
  } catch {
    // A status check that fails is not a reason to stop somebody typing; the
    // send itself will report the real problem in the transcript.
    isConnected.value = true;
  }
});

/**
 * Sends a turn, and puts the new thread's id in the URL once there is one.
 *
 * The id is only known *after* the first reply, because the API titles and
 * creates the conversation from that first message. `replace` rather than
 * `push`, so the back button does not walk into the empty screen the person
 * just left.
 */
const send = async (text: string): Promise<void> => {
  const wasNew = chat.conversationId === null;

  await chat.send(text);

  if (wasNew && chat.conversationId) {
    await router.replace({ name: 'assistant-conversation', params: { id: chat.conversationId } });
  }
};

const startNew = async (): Promise<void> => {
  chat.startNew();
  ui.toggleMobileSidebar(false);

  if (routeId.value) {
    await router.push({ name: 'assistant' });
  }

  composer.value?.focus();
};

const openConversation = async (id: string): Promise<void> => {
  ui.toggleMobileSidebar(false);

  if (id !== routeId.value) {
    await router.push({ name: 'assistant-conversation', params: { id } });
  }
};

/**
 * Whether the live area has anything in it.
 *
 * Passed down so the transcript can drop the "thinking" dots the moment there
 * is something real to show instead.
 */
const hasLiveContent = computed(
  () => chat.run.steps.length > 0 || chat.streamingText.length > 0 || chat.confirmation !== null,
);

/** Puts a suggestion in the composer rather than sending it, so it can be edited. */
const useSuggestion = (text: string): void => {
  composer.value?.setText(text);
};

const askToDelete = (conversation: Conversation): void => {
  pendingDelete.value = conversation;
  isDeleteOpen.value = true;
};

const confirmDelete = async (): Promise<void> => {
  const target = pendingDelete.value;

  if (!target || isDeleting.value) {
    return;
  }

  isDeleting.value = true;

  try {
    await conversations.remove(target.id);
    isDeleteOpen.value = false;
    toast.success('Conversation deleted.');

    // Only leave the screen if the thread that was open is the one that went.
    if (target.id === routeId.value) {
      await router.replace({ name: 'assistant' });
    }
  } catch (caught) {
    toast.error(toErrorMessage(caught));
  } finally {
    isDeleting.value = false;
    pendingDelete.value = null;
  }
};

const decideMemory = async (id: string, keep: boolean): Promise<void> => {
  if (memoryBusyId.value) {
    return;
  }

  memoryBusyId.value = id;

  try {
    await (keep ? chat.confirmMemory(id) : chat.forgetMemory(id));
    toast.success(keep ? 'Hadiya will remember that.' : 'Forgotten.');
  } catch (caught) {
    toast.error(toErrorMessage(caught));
  } finally {
    memoryBusyId.value = null;
  }
};
</script>

<template>
  <ChatLayout>
    <template #sidebar>
      <ConversationSidebar
        :active-id="chat.conversationId"
        @new-chat="startNew"
        @open="openConversation"
        @remove="askToDelete"
        @navigate="ui.toggleMobileSidebar(false)"
      />
    </template>

    <template #header>
      <ChatHeader :conversation="chat.conversation" :connected="isConnected" />
    </template>

    <MessageList
      :messages="chat.visibleMessages"
      :pending="chat.pending"
      :thinking="chat.isSending"
      :busy="chat.isSending"
      :is-loading="chat.isLoadingMessages"
      :is-loading-older="chat.isLoadingOlder"
      :has-older="chat.hasOlderMessages"
      :has-live-content="hasLiveContent"
      @load-older="chat.loadOlder()"
      @regenerate="chat.regenerate()"
      @reply="send"
    >
      <template #empty>
        <EmptyChat @pick="useSuggestion" />
      </template>

      <template #live>
        <AgentActivity
          v-if="chat.run.steps.length > 0"
          :steps="chat.run.steps"
          :active="chat.isRunning"
          :reconnecting="chat.run.reconnecting"
        />

        <PendingActionCard
          v-if="chat.confirmation"
          :confirmation="chat.confirmation"
          :disabled="chat.isSending"
          @reply="send"
        />

        <StreamingAnswer v-if="chat.streamingText" :text="chat.streamingText" />

        <p v-if="chat.run.state === 'cancelled'" class="text-[13px] text-ink-500" role="status">
          Stopped. Nothing further was run.
        </p>
      </template>

      <template #footer>
        <MemoryNotice
          :memories="chat.pendingMemories"
          :busy-id="memoryBusyId"
          @confirm="(id) => decideMemory(id, true)"
          @forget="(id) => decideMemory(id, false)"
        />

        <ChatError
          v-if="chat.error"
          :message="chat.error"
          :retriable="chat.canRetry"
          :retrying="chat.isSending"
          @retry="chat.retry()"
          @dismiss="chat.dismissError()"
        />
      </template>
    </MessageList>

    <template #composer>
      <MessageComposer
        ref="composer"
        :busy="chat.isSending"
        :stoppable="chat.isRunning"
        :stopping="chat.isCancelling"
        @send="send"
        @stop="chat.cancel()"
      />
    </template>
  </ChatLayout>

  <DeleteConversationDialog
    v-model:open="isDeleteOpen"
    :conversation="pendingDelete"
    :busy="isDeleting"
    @confirm="confirmDelete"
  />
</template>
