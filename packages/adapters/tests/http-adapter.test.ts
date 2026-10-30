import { describe, expect, it } from 'vitest';

import { createAdapter } from '@grokbot-ai-office/adapters';
import { RelayError } from '@grokbot-ai-office/core';

describe('http adapters', () => {
  it('官方适配器成功时返回 chat completions 的内容', async () => {
    const { fetchImpl, calls } = mockFetch(() =>
      jsonResponse(200, { choices: [{ message: { content: '你好' } }] }),
    );
    const adapter = createAdapter(
      { auth: 'api_key', vendor: 'deepseek', key_env: 'DEEPSEEK_API_KEY' },
      'deepseek',
      { env: { DEEPSEEK_API_KEY: 'test-key' }, fetchImpl },
    );

    const text = await adapter.call(
      { provider: 'deepseek', prompt: '你好' },
      new AbortController().signal,
    );

    expect(text).toBe('你好');
    expect(calls[0]?.url).toBe('https://api.deepseek.com/chat/completions');
    const body = JSON.parse(String(calls[0]?.init?.body)) as {
      model: string;
      messages: Array<{ content: string }>;
    };
    expect(body.model).toBe('deepseek-chat');
    expect(body.messages[0]?.content).toBe('你好');
    expect(header(calls[0]?.init, 'authorization')).toBe('Bearer test-key');
  });

  it('官方适配器把 kimi 和 glm 发到各自的官方地址', async () => {
    const kimi = mockFetch(() => jsonResponse(200, { choices: [{ message: { content: 'k' } }] }));
    const glm = mockFetch(() => jsonResponse(200, { choices: [{ message: { content: 'g' } }] }));

    await createAdapter(
      { auth: 'api_key', vendor: 'kimi', model: 'moonshot-v1-8k', key_env: 'MOONSHOT_API_KEY' },
      'kimi',
      { env: { MOONSHOT_API_KEY: 'test-key' }, fetchImpl: kimi.fetchImpl },
    ).call({ provider: 'kimi', prompt: 'hi' }, new AbortController().signal);

    await createAdapter(
      { auth: 'api_key', vendor: 'glm', model: 'glm-4-flash', key_env: 'ZHIPU_API_KEY' },
      'glm',
      { env: { ZHIPU_API_KEY: 'test-key' }, fetchImpl: glm.fetchImpl },
    ).call({ provider: 'glm', prompt: 'hi' }, new AbortController().signal);

    expect(kimi.calls[0]?.url).toBe('https://api.moonshot.cn/v1/chat/completions');
    expect(glm.calls[0]?.url).toBe('https://open.bigmodel.cn/api/paas/v4/chat/completions');
  });

  it('官方适配器在 401 和 403 时返回 AUTH_EXPIRED', async () => {
    for (const status of [401, 403]) {
      const { fetchImpl } = mockFetch(() => jsonResponse(status, { error: 'unauthorized' }));
      const error = await capture(() =>
        createAdapter(
          { auth: 'api_key', vendor: 'deepseek', key_env: 'DEEPSEEK_API_KEY' },
          'deepseek',
          { env: { DEEPSEEK_API_KEY: 'test-key' }, fetchImpl },
        ).call({ provider: 'deepseek', prompt: 'hi' }, new AbortController().signal),
      );
      expect(error.code).toBe('AUTH_EXPIRED');
    }
  });

  it('官方适配器在 500 时返回 HTTP_ERROR 并脱敏响应体', async () => {
    const secret = ['sk', 'supersecretvalue'].join('-');
    const { fetchImpl } = mockFetch(() => jsonResponse(500, { error: secret }));
    const error = await capture(() =>
      createAdapter(
        {
          auth: 'api_key',
          vendor: 'deepseek',
          model: 'deepseek-chat',
          key_env: 'DEEPSEEK_API_KEY',
        },
        'deepseek',
        { env: { DEEPSEEK_API_KEY: 'test-key' }, fetchImpl },
      ).call({ provider: 'deepseek', prompt: 'hi' }, new AbortController().signal),
    );

    expect(error.code).toBe('HTTP_ERROR');
    expect(error.message).toContain('500');
    expect(error.message).not.toContain(secret);
    expect(error.message).toContain('[REDACTED]');
  });

  it('官方适配器在空内容时返回 EMPTY_RESPONSE', async () => {
    const { fetchImpl } = mockFetch(() =>
      jsonResponse(200, { choices: [{ message: { content: '   ' } }] }),
    );
    const error = await capture(() =>
      createAdapter(
        { auth: 'api_key', vendor: 'deepseek', key_env: 'DEEPSEEK_API_KEY' },
        'deepseek',
        { env: { DEEPSEEK_API_KEY: 'test-key' }, fetchImpl },
      ).call({ provider: 'deepseek', prompt: 'hi' }, new AbortController().signal),
    );
    expect(error.code).toBe('EMPTY_RESPONSE');
  });

  it('官方适配器在缺少密钥时返回 AUTH_MISSING 且不发请求', async () => {
    const { fetchImpl, calls } = mockFetch(() => jsonResponse(200, {}));
    const error = await capture(() =>
      createAdapter(
        { auth: 'api_key', vendor: 'deepseek', key_env: 'DEEPSEEK_API_KEY' },
        'deepseek',
        { env: {}, fetchImpl },
      ).call({ provider: 'deepseek', prompt: 'hi' }, new AbortController().signal),
    );

    expect(error.code).toBe('AUTH_MISSING');
    expect(error.message).toContain('DEEPSEEK_API_KEY');
    expect(calls).toHaveLength(0);
  });

  it('官方适配器遇到尚未实现的 vendor 时返回 CONFIG_INVALID', async () => {
    const { fetchImpl, calls } = mockFetch(() => jsonResponse(200, {}));
    const error = await capture(() =>
      createAdapter({ auth: 'api_key', vendor: 'minimax', key_env: 'MINIMAX_API_KEY' }, 'minimax', {
        env: { MINIMAX_API_KEY: 'test-key' },
        fetchImpl,
      }).call({ provider: 'claude', prompt: 'hi' }, new AbortController().signal),
    );

    expect(error.code).toBe('CONFIG_INVALID');
    expect(calls).toHaveLength(0);
  });

  it('openai 兼容适配器在没有 key_env 时不发送 Authorization', async () => {
    const { fetchImpl, calls } = mockFetch(() =>
      jsonResponse(200, { choices: [{ message: { content: 'local' } }] }),
    );
    const adapter = createAdapter(
      {
        auth: 'openai_compatible',
        base_url: 'http://localhost:11434/v1',
        model: 'qwen2.5:7b',
        key_env: null,
      },
      'ollama-local',
      { env: {}, fetchImpl },
    );

    await expect(
      adapter.call({ provider: 'ollama-local', prompt: 'hi' }, new AbortController().signal),
    ).resolves.toBe('local');
    expect(calls[0]?.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(header(calls[0]?.init, 'authorization')).toBeUndefined();
  });

  it('openai 兼容适配器在 401 时返回 AUTH_EXPIRED', async () => {
    const { fetchImpl } = mockFetch(() => jsonResponse(401, { error: 'no' }));
    const error = await capture(() =>
      createAdapter(
        {
          auth: 'openai_compatible',
          base_url: 'https://example.test/v1',
          model: 'demo',
          key_env: 'OPENAI_API_KEY',
        },
        'proxy',
        { env: { OPENAI_API_KEY: 'test-key' }, fetchImpl },
      ).call({ provider: 'proxy', prompt: 'hi' }, new AbortController().signal),
    );
    expect(error.code).toBe('AUTH_EXPIRED');
  });

  it('http 适配器 selfcheck 只探测端点，不把密钥放进请求', async () => {
    const seen: Array<{ url: string; authorization: string | undefined }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      seen.push({ url: String(input), authorization: header(init, 'authorization') });
      return jsonResponse(200, { ok: true });
    };
    const adapter = createAdapter(
      { auth: 'api_key', vendor: 'deepseek', key_env: 'DEEPSEEK_API_KEY' },
      'deepseek',
      { env: { DEEPSEEK_API_KEY: 'test-key' }, fetchImpl },
    );

    await expect(adapter.selfcheck()).resolves.toMatchObject({ ok: true });
    expect(seen).toEqual([{ url: 'https://api.deepseek.com', authorization: undefined }]);
  });
});

interface RecordedCall {
  url: string;
  init?: RequestInit;
}

function mockFetch(respond: () => Response): { fetchImpl: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const call = { url: String(input), init };
    calls.push(call);
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
