import { describe, expect, it } from 'vitest';

import { createAdapter } from '@grokbot-ai-office/adapters';
import { RelayError } from '@grokbot-ai-office/core';

describe('createAdapter', () => {
  it('createAdapter 按 auth 返回对应种类', () => {
    expect(
      createAdapter(
        {
          auth: 'subscription',
          command: ['echo', 'hi'],
          safe_mode: 'echo',
        },
        'codex',
      ).kind,
    ).toBe('cli');
    expect(
      createAdapter(
        { auth: 'api_key', vendor: 'deepseek', key_env: 'DEEPSEEK_API_KEY' },
        'deepseek',
      ).kind,
    ).toBe('http');
    expect(
      createAdapter(
        {
          auth: 'openai_compatible',
          base_url: 'http://localhost:11434/v1',
          model: 'qwen2.5:7b',
          key_env: null,
        },
        'ollama-local',
      ).kind,
    ).toBe('http');
  });

  it('createAdapter 遇到未知 auth 时抛出 CONFIG_INVALID', () => {
    expect(() =>
      createAdapter({ auth: 'oauth' } as unknown as Parameters<typeof createAdapter>[0], 'custom'),
    ).toThrow(RelayError);
  });
});
