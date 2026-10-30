import { describe, expect, it } from 'vitest';

import { createAdapter } from '@grokbot-ai-office/adapters';
import { RelayError } from '@grokbot-ai-office/core';

const claudeKey = 'claude-test-key';
const geminiKey = 'gemini-test-key';

describe('anthropic adapter', () => {
  it('anthropic 适配器成功时返回 content 文本块', async () => {
    const { fetchImpl, calls } = mockFetch(() =>
      jsonResponse(200, {
        content: [
          { type: 'thinking', thinking: 'skip' },
          { type: 'text', text: '你' },
          { type: 'text', text: '好' },
        ],
      }),
    );
    const text = await createAdapter(
      { auth: 'api_key', vendor: 'anthropic', key_env: 'ANTHROPIC_API_KEY' },
      'claude',
      { env: { ANTHROPIC_API_KEY: claudeKey }, fetchImpl },
    ).call({ provider: 'claude', prompt: '你好' }, new AbortController().signal);

    expect(text).toBe('你好');
    expect(calls[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(calls[0]?.url).not.toContain(claudeKey);
    expect(header(calls[0]?.init, 'x-api-key')).toBe(claudeKey);
    expect(header(calls[0]?.init, 'anthropic-version')).toBe('2023-06-01');
    const body = JSON.parse(String(calls[0]?.init?.body)) as {
      model: string;
      max_tokens: number;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe('claude-sonnet-4-5');
    expect(body.max_tokens).toBe(4096);
    expect(body.messages).toEqual([{ role: 'user', content: '你好' }]);
    expect(JSON.stringify(body)).not.toContain(claudeKey);
  });

  it('anthropic 适配器在 401 时返回 AUTH_EXPIRED', async () => {
    const error = await callClaude(401, { error: 'unauthorized' }, claudeKey);
    expect(error.code).toBe('AUTH_EXPIRED');
    expect(error.message).not.toContain(claudeKey);
  });

  it('anthropic 适配器在 500 时返回 HTTP_ERROR 并脱敏', async () => {
    const secret = ['sk', 'supersecretvalue'].join('-');
    const error = await callClaude(500, { error: `${secret} ${claudeKey}` }, claudeKey);
    expect(error.code).toBe('HTTP_ERROR');
    expect(error.message).toContain('500');
    expect(error.message).not.toContain(secret);
    expect(error.message).not.toContain(claudeKey);
  });

  it('anthropic 适配器在空内容时返回 EMPTY_RESPONSE', async () => {
    const error = await callClaude(200, { content: [{ type: 'text', text: '   ' }] }, claudeKey);
    expect(error.code).toBe('EMPTY_RESPONSE');
  });

  it('anthropic 适配器在缺少密钥时返回 AUTH_MISSING 且不发请求', async () => {
    const { fetchImpl, calls } = mockFetch(() => jsonResponse(200, {}));
    const error = await capture(() =>
      createAdapter(
        { auth: 'api_key', vendor: 'anthropic', key_env: 'ANTHROPIC_API_KEY' },
        'claude',
        { env: {}, fetchImpl },
      ).call({ provider: 'claude', prompt: 'hi' }, new AbortController().signal),
    );
    expect(error.code).toBe('AUTH_MISSING');
    expect(error.message).toContain('ANTHROPIC_API_KEY');
    expect(calls).toHaveLength(0);
  });

  it('anthropic 适配器 selfcheck 探测时不发送密钥', async () => {
    const seen: Array<{ url: string; apiKey: string | undefined }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      seen.push({ url: String(input), apiKey: header(init, 'x-api-key') });
      return jsonResponse(200, {});
    };
    const check = await createAdapter(
      { auth: 'api_key', vendor: 'anthropic', key_env: 'ANTHROPIC_API_KEY' },
      'claude',
      { env: { ANTHROPIC_API_KEY: claudeKey }, fetchImpl },
    ).selfcheck();

    expect(check.ok).toBe(true);
    expect(seen).toEqual([{ url: 'https://api.anthropic.com', apiKey: undefined }]);
    expect(seen[0]?.url).not.toContain(claudeKey);
  });
});

describe('gemini adapter', () => {
  it('gemini 适配器成功时返回 parts 文本且密钥不在 URL 中', async () => {
    const { fetchImpl, calls } = mockFetch(() =>
      jsonResponse(200, {
        candidates: [{ content: { parts: [{ text: '你' }, { text: '好' }] } }],
      }),
    );
    const text = await createAdapter(
      { auth: 'api_key', vendor: 'gemini', model: 'gemini-2.5-flash', key_env: 'GEMINI_API_KEY' },
      'gemini',
      { env: { GEMINI_API_KEY: geminiKey }, fetchImpl },
    ).call({ provider: 'gemini', prompt: '你好' }, new AbortController().signal);

    expect(text).toBe('你好');
    expect(calls[0]?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    );
    expect(calls[0]?.url).not.toContain(geminiKey);
    expect(calls[0]?.url).not.toContain('key=');
    expect(header(calls[0]?.init, 'x-goog-api-key')).toBe(geminiKey);
    const body = JSON.parse(String(calls[0]?.init?.body)) as {
      contents: Array<{ role: string; parts: Array<{ text: string }> }>;
    };
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: '你好' }] }]);
    expect(JSON.stringify(body)).not.toContain(geminiKey);
  });

  it('gemini 适配器在 401 时返回 AUTH_EXPIRED', async () => {
    const error = await callGemini(401, { error: 'unauthorized' }, geminiKey);
    expect(error.code).toBe('AUTH_EXPIRED');
    expect(error.message).not.toContain(geminiKey);
  });

  it('gemini 适配器在 500 时返回 HTTP_ERROR 并脱敏', async () => {
    const secret = ['sk', 'supersecretvalue'].join('-');
    const error = await callGemini(500, { error: `${secret} ${geminiKey}` }, geminiKey);
    expect(error.code).toBe('HTTP_ERROR');
    expect(error.message).toContain('500');
    expect(error.message).not.toContain(secret);
    expect(error.message).not.toContain(geminiKey);
  });

  it('gemini 适配器在空内容时返回 EMPTY_RESPONSE', async () => {
    const error = await callGemini(
      200,
      { candidates: [{ content: { parts: [{ text: '  ' }] } }] },
      geminiKey,
    );
    expect(error.code).toBe('EMPTY_RESPONSE');
  });

  it('gemini 适配器在缺少密钥时返回 AUTH_MISSING 且不发请求', async () => {
    const { fetchImpl, calls } = mockFetch(() => jsonResponse(200, {}));
    const error = await capture(() =>
      createAdapter({ auth: 'api_key', vendor: 'gemini', key_env: 'GEMINI_API_KEY' }, 'gemini', {
        env: {},
        fetchImpl,
      }).call({ provider: 'gemini', prompt: 'hi' }, new AbortController().signal),
    );
    expect(error.code).toBe('AUTH_MISSING');
    expect(error.message).toContain('GEMINI_API_KEY');
    expect(calls).toHaveLength(0);
  });

  it('gemini 适配器 selfcheck 探测时不发送密钥', async () => {
    const seen: Array<{ url: string; apiKey: string | undefined }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      seen.push({ url: String(input), apiKey: header(init, 'x-goog-api-key') });
      return jsonResponse(404, {});
    };
    const check = await createAdapter(
      { auth: 'api_key', vendor: 'gemini', key_env: 'GEMINI_API_KEY' },
      'gemini',
      { env: { GEMINI_API_KEY: geminiKey }, fetchImpl },
    ).selfcheck();

    expect(check.ok).toBe(true);
    expect(seen).toEqual([{ url: 'https://generativelanguage.googleapis.com', apiKey: undefined }]);
    expect(seen[0]?.url).not.toContain(geminiKey);
    expect(seen[0]?.url).not.toContain('key=');
  });
});

function callClaude(status: number, body: unknown, apiKey: string): Promise<RelayError> {
  return capture(() => {
    const { fetchImpl } = mockFetch(() => jsonResponse(status, body));
    return createAdapter(
      { auth: 'api_key', vendor: 'anthropic', key_env: 'ANTHROPIC_API_KEY' },
      'claude',
      { env: { ANTHROPIC_API_KEY: apiKey }, fetchImpl },
    ).call({ provider: 'claude', prompt: 'hi' }, new AbortController().signal);
  });
}

function callGemini(status: number, body: unknown, apiKey: string): Promise<RelayError> {
  return capture(() => {
    const { fetchImpl } = mockFetch(() => jsonResponse(status, body));
    return createAdapter(
      { auth: 'api_key', vendor: 'gemini', model: 'gemini-2.5-flash', key_env: 'GEMINI_API_KEY' },
      'gemini',
      { env: { GEMINI_API_KEY: apiKey }, fetchImpl },
    ).call({ provider: 'gemini', prompt: 'hi' }, new AbortController().signal);
  });
}

interface RecordedCall {
  url: string;
  init?: RequestInit;
}

function mockFetch(respond: () => Response): { fetchImpl: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return respond();
  };
  return { fetchImpl, calls };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function header(init: RequestInit | undefined, name: string): string | undefined {
  const headers = init?.headers;
  if (!headers || headers instanceof Headers || Array.isArray(headers)) {
    return undefined;
  }
  const value = headers[name] ?? headers[name.toLowerCase()];
  return typeof value === 'string' ? value : undefined;
}

async function capture(run: () => Promise<unknown>): Promise<RelayError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof RelayError) {
      return error;
    }
    throw error;
  }
  throw new Error('预期抛出 RelayError');
}
