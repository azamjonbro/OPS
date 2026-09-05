import { SPEECH_MAX_UPLOAD_BYTES, SPEECH_MIN_UPLOAD_BYTES } from '@hadiya/shared';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../../app.js';
import { HTTP_STATUS } from '../../../core/http/http-status.js';
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../../../test/database.js';
import { createTestBranch, signInAs } from '../../../test/factories.js';
import { AiProviderError } from '../provider/ai-error.js';
import type { FetchLike } from '../provider/ai-http.js';
import { createUnconfiguredSpeechProvider } from './index.js';
import { OpenAiSpeechProvider } from './openai-stt.provider.js';
import { setSpeechProvider, type SpeechProvider } from './stt-provider.js';

/**
 * Dictation end to end, with a scripted transcription model.
 *
 * No paid call is made: the service is written against the provider interface,
 * so every answer here — including the failures — is written by the test.
 */
const app = createApp();
const url = '/api/v1/ai/transcribe';

beforeAll(startTestDatabase);
afterAll(stopTestDatabase);
beforeEach(clearTestDatabase);
afterEach(() => setSpeechProvider(null));

const signIn = async () => {
  const branch = await createTestBranch();

  return signInAs(app, 'manager', String(branch._id));
};

/** Big enough to pass the "did the recorder capture anything" floor. */
const recording = (bytes = 4_096): Buffer => Buffer.alloc(bytes, 7);

interface ScriptedSpeechProvider extends SpeechProvider {
  readonly calls: Array<{ contentType: string; bytes: number; language: string | null }>;
}

const scripted = (
  outcome: Partial<{ text: string; durationSeconds: number; language: string; model: string }> = {},
  failWith?: Error,
): ScriptedSpeechProvider => {
  const calls: ScriptedSpeechProvider['calls'] = [];

  return {
    name: 'scripted',
    isConfigured: true,
    model: 'scripted-stt',
    calls,
    transcribe: async (input) => {
      calls.push({
        contentType: input.contentType,
        bytes: input.audio.byteLength,
        language: input.language ?? null,
      });

      if (failWith) {
        throw failWith;
      }

      return {
        text: outcome.text ?? 'Bugungi savdoni tahlil qilib ber',
        durationSeconds: outcome.durationSeconds ?? 3.2,
        language: outcome.language ?? 'uz',
        model: outcome.model ?? 'scripted-stt',
      };
    },
  };
};

describe('transcribing a recording', () => {
  it('returns the words, and only the words', async () => {
    setSpeechProvider(scripted());
    const { authorization } = await signIn();

    const response = await request(app)
      .post(url)
      .set('Authorization', authorization)
      .attach('audio', recording(), { filename: 'take.webm', contentType: 'audio/webm' });

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data).toEqual({
      text: 'Bugungi savdoni tahlil qilib ber',
      durationSeconds: 3.2,
      language: 'uz',
      model: 'scripted-stt',
    });
  });

  it('accepts the formats a browser actually records', async () => {
    const provider = scripted();
    setSpeechProvider(provider);
    const { authorization } = await signIn();

    for (const contentType of ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg']) {
      const response = await request(app)
        .post(url)
        .set('Authorization', authorization)
        .attach('audio', recording(), { filename: 'take', contentType });

      expect(response.status).toBe(HTTP_STATUS.OK);
    }

    // The codec parameter is stripped before the provider is asked.
    expect(provider.calls.map((call) => call.contentType)).toEqual([
      'audio/webm',
      'audio/mp4',
      'audio/ogg',
    ]);
  });

  it('never sends the transcript on to the assistant', async () => {
    setSpeechProvider(scripted());
    const { authorization } = await signIn();

    const response = await request(app)
      .post(url)
      .set('Authorization', authorization)
      .attach('audio', recording(), { filename: 'take.webm', contentType: 'audio/webm' });

    // The whole design decision, asserted: transcription answers with text and
    // opens no conversation. Sending is the person's to do, afterwards.
    expect(response.body.data).not.toHaveProperty('conversationId');
    expect(response.body.data).not.toHaveProperty('message');
  });

  it('does not trust the filename the browser sent', async () => {
    const provider = scripted();
    setSpeechProvider(provider);
    const { authorization } = await signIn();

    const response = await request(app)
      .post(url)
      .set('Authorization', authorization)
      .attach('audio', recording(), {
        filename: '../../etc/passwd.webm',
        contentType: 'audio/webm',
      });

    expect(response.status).toBe(HTTP_STATUS.OK);
    // Nothing derived from the name reaches the provider; the content type is
    // what decides the format.
    expect(provider.calls[0]?.contentType).toBe('audio/webm');
  });
});

describe('what is refused', () => {
  it('refuses an unauthenticated request', async () => {
    setSpeechProvider(scripted());

    const response = await request(app)
      .post(url)
      .attach('audio', recording(), { filename: 'take.webm', contentType: 'audio/webm' });

    expect(response.status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });

  it('refuses a request with no recording attached', async () => {
    setSpeechProvider(scripted());
    const { authorization } = await signIn();

    const response = await request(app).post(url).set('Authorization', authorization);

    expect(response.status).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(response.body.error.message).toMatch(/no recording/i);
  });

  it('refuses a format that is not audio, before reaching the provider', async () => {
    const provider = scripted();
    setSpeechProvider(provider);
    const { authorization } = await signIn();

    const response = await request(app)
      .post(url)
      .set('Authorization', authorization)
      .attach('audio', Buffer.from('<html>'), {
        filename: 'payload.html',
        contentType: 'text/html',
      });

    expect(response.status).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(provider.calls).toHaveLength(0);
  });

  it('refuses a recording beyond the size ceiling', async () => {
    const provider = scripted();
    setSpeechProvider(provider);
    const { authorization } = await signIn();

    const response = await request(app)
      .post(url)
      .set('Authorization', authorization)
      .attach('audio', Buffer.alloc(SPEECH_MAX_UPLOAD_BYTES + 1_024, 1), {
        filename: 'long.webm',
        contentType: 'audio/webm',
      });

    expect(response.status).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(response.body.error.message).toMatch(/too large/i);
    // Rejected at the edge: nothing is paid to find out it was too big.
    expect(provider.calls).toHaveLength(0);
  }, 20_000);

  it('refuses a recording that captured nothing', async () => {
    const provider = scripted();
    setSpeechProvider(provider);
    const { authorization } = await signIn();

    const response = await request(app)
      .post(url)
      .set('Authorization', authorization)
      .attach('audio', Buffer.alloc(SPEECH_MIN_UPLOAD_BYTES - 1, 0), {
        filename: 'empty.webm',
        contentType: 'audio/webm',
      });

    expect(response.status).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(response.body.error.message).toMatch(/too short/i);
    expect(provider.calls).toHaveLength(0);
  });

  it('treats a transcript with no words as a failure, not an empty success', async () => {
    setSpeechProvider(scripted({ text: '   ' }));
    const { authorization } = await signIn();

    const response = await request(app)
      .post(url)
      .set('Authorization', authorization)
      .attach('audio', recording(), { filename: 'take.webm', contentType: 'audio/webm' });

    // An empty success would silently clear the composer.
    expect(response.status).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(response.body.error.message).toMatch(/could not make out/i);
  });
});

describe('when the provider fails', () => {
  it('reports an unavailable provider without leaking its wording', async () => {
    setSpeechProvider(
      scripted({}, new AiProviderError('upstream_error', 'the provider answered 500')),
    );
    const { authorization } = await signIn();

    const response = await request(app)
      .post(url)
      .set('Authorization', authorization)
      .attach('audio', recording(), { filename: 'take.webm', contentType: 'audio/webm' });

    expect(response.status).toBe(HTTP_STATUS.SERVICE_UNAVAILABLE);
    expect(response.body.error.message).toBe('Voice transcription failed. Please try again.');
  });

  it('says a recording took too long rather than blaming the network', async () => {
    setSpeechProvider(scripted({}, new AiProviderError('timeout', 'no answer within 60000ms')));
    const { authorization } = await signIn();

    const response = await request(app)
      .post(url)
      .set('Authorization', authorization)
      .attach('audio', recording(), { filename: 'take.webm', contentType: 'audio/webm' });

    expect(response.status).toBe(HTTP_STATUS.SERVICE_UNAVAILABLE);
    expect(response.body.error.message).toMatch(/took too long/i);
  });

  it('reports a rejected key as an outage, never as the caller’s mistake', async () => {
    setSpeechProvider(
      scripted({}, new AiProviderError('invalid_credentials', 'the API key sk-live was rejected')),
    );
    const { authorization } = await signIn();

    const response = await request(app)
      .post(url)
      .set('Authorization', authorization)
      .attach('audio', recording(), { filename: 'take.webm', contentType: 'audio/webm' });

    expect(response.status).toBe(HTTP_STATUS.SERVICE_UNAVAILABLE);
    // A misconfiguration is ours, and the key never reaches the client.
    expect(JSON.stringify(response.body)).not.toMatch(/sk-live/);
  });

  it('asks the caller to wait when the provider is rate limiting', async () => {
    setSpeechProvider(scripted({}, new AiProviderError('rate_limited', 'slow down')));
    const { authorization } = await signIn();

    const response = await request(app)
      .post(url)
      .set('Authorization', authorization)
      .attach('audio', recording(), { filename: 'take.webm', contentType: 'audio/webm' });

    expect(response.status).toBe(HTTP_STATUS.TOO_MANY_REQUESTS);
  });

  it('says the account is out of credit rather than telling the caller to wait', async () => {
    setSpeechProvider(scripted({}, new AiProviderError('quota_exhausted', 'no credit remaining')));
    const { authorization } = await signIn();

    const response = await request(app)
      .post(url)
      .set('Authorization', authorization)
      .attach('audio', recording(), { filename: 'take.webm', contentType: 'audio/webm' });

    // Not a 429. An empty balance does not clear on its own, and "try again
    // shortly" would be advice that never comes true.
    expect(response.status).toBe(HTTP_STATUS.SERVICE_UNAVAILABLE);
    expect(response.body.error.message).toContain('run out of credit');
  });

  it('refuses clearly when no transcription model is configured', async () => {
    setSpeechProvider(createUnconfiguredSpeechProvider('set OPENAI_API_KEY'));
    const { authorization } = await signIn();

    const response = await request(app)
      .post(url)
      .set('Authorization', authorization)
      .attach('audio', recording(), { filename: 'take.webm', contentType: 'audio/webm' });

    expect(response.status).toBe(HTTP_STATUS.SERVICE_UNAVAILABLE);
    expect(response.body.error.message).toMatch(/not available/i);
  });
});

describe('the OpenAI provider, driven by scripted HTTP', () => {
  const createFetch = (
    script: Array<{ status?: number; body?: unknown; raw?: string }>,
  ): {
    fetchImpl: FetchLike;
    calls: Array<{ url: string; headers: unknown; body: FormData }>;
  } => {
    const calls: Array<{ url: string; headers: unknown; body: FormData }> = [];
    let index = 0;

    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, headers: init.headers, body: init.body as FormData });

      const scripted = script[index] ?? script.at(-1) ?? {};
      index += 1;

      return new Response(scripted.raw ?? JSON.stringify(scripted.body ?? {}), {
        status: scripted.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    return { fetchImpl, calls };
  };

  const build = (script: Parameters<typeof createFetch>[0], language: string | null = null) => {
    const { fetchImpl, calls } = createFetch(script);

    return {
      calls,
      provider: new OpenAiSpeechProvider({
        apiKey: 'sk-test-key',
        model: 'whisper-1',
        baseUrl: 'https://stt.test/v1',
        timeoutMs: 2_000,
        maxRetries: 0,
        language,
        fetchImpl,
        sleep: async () => undefined,
      }),
    };
  };

  it('reads an exhausted balance out of a 429 and does not retry it', async () => {
    const { fetchImpl, calls } = createFetch([
      {
        status: 429,
        body: {
          error: {
            message: 'You have no credits remaining.',
            type: 'insufficient_quota',
            code: 'credit_balance_exhausted',
          },
        },
      },
    ]);

    const provider = new OpenAiSpeechProvider({
      apiKey: 'sk-test-key',
      model: 'whisper-1',
      baseUrl: 'https://stt.test/v1',
      timeoutMs: 2_000,
      // Retries allowed, precisely so the test can prove none are spent.
      maxRetries: 2,
      language: null,
      fetchImpl,
      sleep: async () => undefined,
    });

    await expect(
      provider.transcribe({ audio: recording(), contentType: 'audio/webm' }),
    ).rejects.toMatchObject({ kind: 'quota_exhausted' });

    // Retrying an empty balance only makes the person wait three times as long
    // for the same answer.
    expect(calls).toHaveLength(1);
  });

  it('still treats an ordinary 429 as a rate limit worth retrying', async () => {
    const { fetchImpl, calls } = createFetch([
      { status: 429, body: { error: { code: 'rate_limit_exceeded' } } },
      { body: { text: 'Salom' } },
    ]);

    const provider = new OpenAiSpeechProvider({
      apiKey: 'sk-test-key',
      model: 'whisper-1',
      baseUrl: 'https://stt.test/v1',
      timeoutMs: 2_000,
      maxRetries: 2,
      language: null,
      fetchImpl,
      sleep: async () => undefined,
    });

    const outcome = await provider.transcribe({ audio: recording(), contentType: 'audio/webm' });

    expect(outcome.text).toBe('Salom');
    expect(calls).toHaveLength(2);
  });

  it('posts the audio as multipart and reads the transcript back', async () => {
    const { provider, calls } = build([
      { body: { text: 'Bugungi savdoni tahlil qilib ber', duration: 2.5, language: 'uzbek' } },
    ]);

    const outcome = await provider.transcribe({
      audio: recording(),
      contentType: 'audio/webm',
    });

    expect(outcome.text).toBe('Bugungi savdoni tahlil qilib ber');
    expect(outcome.durationSeconds).toBe(2.5);
    expect(calls[0]?.url).toBe('https://stt.test/v1/audio/transcriptions');

    const body = calls[0]?.body as FormData;
    expect(body.get('model')).toBe('whisper-1');
    expect(body.get('response_format')).toBe('json');
    // No language sent, so the model detects it — what a bilingual floor needs.
    expect(body.get('language')).toBeNull();
    expect(body.get('file')).toBeInstanceOf(Blob);
  });

  it('sends a configured language when one is pinned', async () => {
    const { provider, calls } = build([{ body: { text: 'salom' } }], 'uz');

    await provider.transcribe({ audio: recording(), contentType: 'audio/webm' });

    expect((calls[0]?.body as FormData).get('language')).toBe('uz');
  });

  it('keeps the credential in the header, never in the body', async () => {
    const { provider, calls } = build([{ body: { text: 'salom' } }]);

    await provider.transcribe({ audio: recording(), contentType: 'audio/webm' });

    const body = calls[0]?.body as FormData;
    expect([...body.keys()]).not.toContain('api_key');
    expect(JSON.stringify(calls[0]?.headers)).toContain('sk-test-key');
    expect(calls[0]?.url).not.toContain('sk-test-key');
  });

  it('names the file from the content type, never from the client', async () => {
    const { provider, calls } = build([{ body: { text: 'salom' } }]);

    await provider.transcribe({ audio: recording(), contentType: 'audio/mp4' });

    const file = (calls[0]?.body as FormData).get('file') as File;
    expect(file.name).toBe('recording.mp4');
  });

  it('reports a rejected key as a credentials failure', async () => {
    const { provider } = build([{ status: 401, body: { error: { message: 'bad key' } } }]);

    const error = await provider
      .transcribe({ audio: recording(), contentType: 'audio/webm' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AiProviderError);
    expect((error as AiProviderError).kind).toBe('invalid_credentials');
  });

  it('reports a body that is not JSON', async () => {
    const { provider } = build([{ raw: 'not json at all' }]);

    const error = await provider
      .transcribe({ audio: recording(), contentType: 'audio/webm' })
      .catch((caught: unknown) => caught);

    expect((error as AiProviderError).kind).toBe('malformed_response');
  });

  it('reports a reply with no transcript in it', async () => {
    const { provider } = build([{ body: { duration: 3 } }]);

    const error = await provider
      .transcribe({ audio: recording(), contentType: 'audio/webm' })
      .catch((caught: unknown) => caught);

    expect((error as AiProviderError).kind).toBe('malformed_response');
  });

  it('reports a timeout as a timeout', async () => {
    const provider = new OpenAiSpeechProvider({
      apiKey: 'sk-test-key',
      model: 'whisper-1',
      baseUrl: 'https://stt.test/v1',
      timeoutMs: 20,
      maxRetries: 0,
      sleep: async () => undefined,
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const abort = new Error('aborted');
            abort.name = 'AbortError';
            reject(abort);
          });
        }),
    });

    const error = await provider
      .transcribe({ audio: recording(), contentType: 'audio/webm' })
      .catch((caught: unknown) => caught);

    expect((error as AiProviderError).kind).toBe('timeout');
  });

  it('retries a transient failure and accepts the second answer', async () => {
    const { fetchImpl, calls } = createFetch([
      { status: 503, body: { error: { message: 'busy' } } },
      { body: { text: 'salom' } },
    ]);

    const provider = new OpenAiSpeechProvider({
      apiKey: 'sk-test-key',
      model: 'whisper-1',
      baseUrl: 'https://stt.test/v1',
      timeoutMs: 2_000,
      maxRetries: 1,
      fetchImpl,
      sleep: async () => undefined,
    });

    const outcome = await provider.transcribe({
      audio: recording(),
      contentType: 'audio/webm',
    });

    expect(outcome.text).toBe('salom');
    expect(calls).toHaveLength(2);
  });
});

describe('nothing is kept', () => {
  it('carries the audio through memory, so there is no file to clean up', async () => {
    const provider = scripted();
    setSpeechProvider(provider);
    const { authorization } = await signIn();

    await request(app)
      .post(url)
      .set('Authorization', authorization)
      .attach('audio', recording(6_000), { filename: 'take.webm', contentType: 'audio/webm' });

    // The exact bytes reached the provider as a buffer. Multer is configured
    // with memory storage, so nothing was ever written to disk — which is why
    // there is no temporary-file cleanup to test: there is no temporary file.
    expect(provider.calls[0]?.bytes).toBe(6_000);
  });
});
