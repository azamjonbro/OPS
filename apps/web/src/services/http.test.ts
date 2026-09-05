import { describe, expect, it, vi } from 'vitest';

import { api, httpClient } from '@/services/http';

/**
 * The envelope, and the one response that has none.
 *
 * Every endpoint answers `{ success, data, meta }` — except a `204`, which
 * answers with nothing at all. That exception broke deleting: `response.data`
 * is an empty string, reading `.success` on it gives `undefined`, the envelope
 * check read that as a failure, and reaching for `.error.message` threw. The
 * record was gone from the database and the screen said it had failed, which is
 * the worst of both.
 */
describe('the API envelope', () => {
  it('returns nothing for a 204 instead of trying to unwrap it', async () => {
    vi.spyOn(httpClient, 'request').mockResolvedValue({
      status: 204,
      // What axios actually hands back for an empty body.
      data: '',
      headers: {},
      config: {},
      statusText: 'No Content',
    });

    await expect(api.delete<void>('/v1/integrations/abc')).resolves.toBeUndefined();
  });

  it('unwraps an ordinary success', async () => {
    vi.spyOn(httpClient, 'request').mockResolvedValue({
      status: 200,
      data: {
        success: true,
        data: { id: 'abc' },
        meta: { requestId: 'r1', timestamp: '2026-09-05T00:00:00.000Z' },
      },
      headers: {},
      config: {},
      statusText: 'OK',
    });

    await expect(api.get('/v1/integrations/abc')).resolves.toEqual({ id: 'abc' });
  });

  it('turns a failed envelope into an error carrying the API’s own code', async () => {
    vi.spyOn(httpClient, 'request').mockResolvedValue({
      status: 503,
      data: {
        success: false,
        error: {
          code: 'DEPENDENCY_UNAVAILABLE',
          message: 'The AI account has run out of credit.',
          // The classification the chat screen reads to say something more
          // useful than "not responding".
          details: { integration: 'ai', kind: 'quota_exhausted' },
        },
        meta: { requestId: 'r2', timestamp: '2026-09-05T00:00:00.000Z' },
      },
      headers: {},
      config: {},
      statusText: 'Service Unavailable',
    });

    await expect(api.get('/v1/ai/chat')).rejects.toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
      details: { kind: 'quota_exhausted' },
    });
  });
});
