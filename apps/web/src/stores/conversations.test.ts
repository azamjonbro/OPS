import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClientError } from '@/services/api-error';
import { conversationService } from '@/services/conversation.service';
import { groupFor, useConversationsStore } from '@/stores/conversations';
import { makeConversation, paginated } from '@/test/factories';

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('the conversation list', () => {
  it('asks for the first page of active threads', async () => {
    const list = vi
      .spyOn(conversationService, 'list')
      .mockResolvedValue(paginated([makeConversation()]));

    const conversations = useConversationsStore();
    await conversations.load();

    expect(list).toHaveBeenCalledWith(
      { page: 1, pageSize: 25, status: 'active' },
      expect.anything(),
    );
    expect(conversations.conversations).toHaveLength(1);
  });

  it('appends the next page rather than replacing what is on screen', async () => {
    const first = makeConversation({ title: 'First' });
    const second = makeConversation({ title: 'Second' });

    vi.spyOn(conversationService, 'list')
      .mockResolvedValueOnce(paginated([first], { page: 1, pageSize: 25, total: 26 }))
      .mockResolvedValueOnce(paginated([second], { page: 2, pageSize: 25, total: 26 }));

    const conversations = useConversationsStore();
    await conversations.load();

    expect(conversations.hasMore).toBe(true);

    await conversations.loadMore();

    expect(conversations.conversations.map((entry) => entry.title)).toEqual(['First', 'Second']);
    expect(conversations.hasMore).toBe(false);
  });

  it('sends a search term to the API rather than filtering what is loaded', async () => {
    const list = vi.spyOn(conversationService, 'list').mockResolvedValue(paginated([]));

    const conversations = useConversationsStore();
    await conversations.setSearch('  savdo  ');

    expect(list).toHaveBeenCalledWith(
      { page: 1, pageSize: 25, status: 'active', search: 'savdo' },
      expect.anything(),
    );
  });

  it('reports a failed load without leaving stale rows behind', async () => {
    vi.spyOn(conversationService, 'list').mockRejectedValue(
      new ApiClientError('Could not reach the server.', { code: 'NETWORK_ERROR' }),
    );

    const conversations = useConversationsStore();
    await conversations.load();

    // Translated like the transcript's failures: the sidebar must not repeat
    // whatever the server said to its own logs.
    expect(conversations.error).toBe(
      'Could not reach Hadiya. Check your connection and try again.',
    );
    expect(conversations.isEmpty).toBe(true);
  });
});

describe('date grouping', () => {
  const now = new Date('2026-09-05T12:00:00.000Z');

  /**
   * The buckets are local days, so the fixtures are built by local arithmetic
   * rather than written as UTC strings — otherwise "yesterday evening" lands in
   * a different bucket depending on where the machine running the tests is.
   */
  const daysAgo = (days: number, hour = 12): string => {
    const when = new Date(now);
    when.setDate(when.getDate() - days);
    when.setHours(hour, 0, 0, 0);

    return when.toISOString();
  };

  it.each([
    [0, 'Today'],
    [1, 'Yesterday'],
    [4, 'Previous 7 days'],
    [40, 'Older'],
  ])('puts a thread last used %i day(s) ago in %s', (days, expected) => {
    expect(groupFor(makeConversation({ lastMessageAt: daysAgo(days) }), now)).toBe(expected);
  });

  it('falls back to when the thread was created if nothing was ever said', () => {
    const conversation = makeConversation({ lastMessageAt: null, createdAt: daysAgo(0, 8) });

    expect(groupFor(conversation, now)).toBe('Today');
  });
});

describe('renaming', () => {
  it('replaces the row with the record the server returned', async () => {
    const conversation = makeConversation({ title: 'Old' });
    vi.spyOn(conversationService, 'list').mockResolvedValue(paginated([conversation]));
    vi.spyOn(conversationService, 'rename').mockResolvedValue({
      ...conversation,
      title: 'Sentyabr savdosi',
    });

    const conversations = useConversationsStore();
    await conversations.load();
    await conversations.rename(conversation.id, 'Sentyabr savdosi');

    expect(conversationService.rename).toHaveBeenCalledWith(conversation.id, 'Sentyabr savdosi');
    expect(conversations.conversations[0]?.title).toBe('Sentyabr savdosi');
  });
});

describe('deleting', () => {
  it('removes the row at once and calls the API', async () => {
    const kept = makeConversation({ title: 'Kept' });
    const doomed = makeConversation({ title: 'Doomed' });
    vi.spyOn(conversationService, 'list').mockResolvedValue(paginated([kept, doomed]));
    vi.spyOn(conversationService, 'remove').mockResolvedValue(undefined);

    const conversations = useConversationsStore();
    await conversations.load();
    await conversations.remove(doomed.id);

    expect(conversationService.remove).toHaveBeenCalledWith(doomed.id);
    expect(conversations.conversations.map((entry) => entry.title)).toEqual(['Kept']);
  });

  it('puts the row back, in its place, when the server refuses', async () => {
    const first = makeConversation({ title: 'First' });
    const second = makeConversation({ title: 'Second' });
    const third = makeConversation({ title: 'Third' });
    vi.spyOn(conversationService, 'list').mockResolvedValue(paginated([first, second, third]));
    vi.spyOn(conversationService, 'remove').mockRejectedValue(
      new ApiClientError('offline', { code: 'NETWORK_ERROR' }),
    );

    const conversations = useConversationsStore();
    await conversations.load();

    await expect(conversations.remove(second.id)).rejects.toThrow();

    // Optimism is only safe if the rollback is exact — including the position.
    expect(conversations.conversations.map((entry) => entry.title)).toEqual([
      'First',
      'Second',
      'Third',
    ]);
  });
});

describe('archiving', () => {
  it('takes the thread out of the list without deleting it', async () => {
    const conversation = makeConversation();
    vi.spyOn(conversationService, 'list').mockResolvedValue(paginated([conversation]));
    const setStatus = vi
      .spyOn(conversationService, 'setStatus')
      .mockResolvedValue({ ...conversation, status: 'archived' });
    const remove = vi.spyOn(conversationService, 'remove');

    const conversations = useConversationsStore();
    await conversations.load();
    await conversations.archive(conversation.id);

    expect(setStatus).toHaveBeenCalledWith(conversation.id, 'archived');
    expect(remove).not.toHaveBeenCalled();
    expect(conversations.isEmpty).toBe(true);
  });
});
