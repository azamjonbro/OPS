import { describe, expect, it, vi } from 'vitest';

import { chatService } from '@/services/chat.service';
import { api } from '@/services/http';
import { makeChatResponse } from '@/test/factories';

/**
 * The assistant's transport.
 *
 * There is one endpoint and this asserts the client keeps it that way: the
 * request carries a sentence and, once there is one, a conversation id — never
 * a tool name, an intent or a user id.
 */
describe('sending a turn', () => {
  it('posts to the one chat endpoint, with no conversation id on the first turn', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue(makeChatResponse());

    await chatService.send('Bugungi savdo?');

    expect(post).toHaveBeenCalledWith(
      '/v1/ai/chat',
      { message: 'Bugungi savdo?' },
      expect.anything(),
    );
  });

  it('carries the conversation id on later turns', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue(makeChatResponse());

    await chatService.send('Yana', 'abc');

    expect(post).toHaveBeenCalledWith(
      '/v1/ai/chat',
      { message: 'Yana', conversationId: 'abc' },
      expect.anything(),
    );
  });

  it('allows a turn far longer than an ordinary request', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue(makeChatResponse());

    await chatService.send('7 kunlik kontent reja tuz');

    // A plan or a generated image runs for a minute or more server-side, and
    // the client's default 30 seconds would report a failure for work that is
    // still running — and would then be retried into a duplicate.
    const options = post.mock.calls[0]?.[2] as { timeout?: number };

    expect(options.timeout).toBeGreaterThanOrEqual(120_000);
  });
});
