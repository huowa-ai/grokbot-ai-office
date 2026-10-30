import { describe, expect, it } from 'vitest';

import { createAdapter } from '@grokbot-ai-office/adapters';
import { RelayError } from '@grokbot-ai-office/core';

describe('createAdapter', () => {
  it('createAdapter 按 auth 返回对应种类且不调用真实 AI', async () => {
    const subscription = createAdapter('subscription');
    const apiKey = createAdapter('api_key');
    const compatible = createAdapter('openai_compatible');

    expect(subscription.kind).toBe('cli');
    expect(apiKey.kind).toBe('http');
    expect(compatible.kind).toBe('http');

    const signal = new AbortController().signal;
    const request = { provider: 'codex', prompt: 'hi' };
    await expect(subscription.call(request, signal)).rejects.toBeInstanceOf(RelayError);
    await expect(subscription.selfcheck()).resolves.toMatchObject({ ok: false });
    await expect(apiKey.selfcheck()).resolves.toMatchObject({ ok: false });
    await expect(compatible.selfcheck()).resolves.toMatchObject({ ok: false });
  });
});
