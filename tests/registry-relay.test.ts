import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { RelayError, relay } from '@grokbot-ai-office/core';
import { loadProvidersConfig } from '@grokbot-ai-office/registry';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('registry 与 relay', () => {
  it('已加载的注册表找不到名字时 relay 返回 PROVIDER_NOT_FOUND', async () => {
    const config = loadProvidersConfig(path.join(repoRoot, 'configs', 'providers.yaml'));
    const result = await relay(
      { provider: 'not-in-registry', prompt: 'hi' },
      {
        hasProvider: (name) => Object.hasOwn(config.providers, name),
      },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBeInstanceOf(RelayError);
    expect(result.error?.code).toBe('PROVIDER_NOT_FOUND');
    expect(Object.hasOwn(config.providers, 'codex')).toBe(true);
  });
});
