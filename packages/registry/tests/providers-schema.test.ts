import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  ProvidersConfigError,
  loadProvidersConfig,
  parseProvidersConfig,
} from '@grokbot-ai-office/registry';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const validFile = {
  version: 1,
  defaults: { timeout_ms: 180000 },
  providers: {},
};

describe('providersFileSchema', () => {
  it('subscription 缺少 safe_mode 时校验失败', () => {
    const error = capture(() =>
      parseProvidersConfig({
        ...validFile,
        providers: {
          codex: {
            auth: 'subscription',
            command: ['codex', 'exec'],
            input: 'stdin',
          },
        },
      }),
    );

    expect(error).toBeInstanceOf(ProvidersConfigError);
    expect(error.issues.some((issue) => issue.path.split('.').includes('safe_mode'))).toBe(true);
  });

  it('key_env 写成疑似密钥时校验失败且不回显内容', () => {
    const error = capture(() =>
      parseProvidersConfig({
        ...validFile,
        providers: {
          deepseek: {
            auth: 'api_key',
            vendor: 'deepseek',
            model: 'deepseek-chat',
            key_env: 'sk-example',
          },
        },
      }),
    );

    expect(error).toBeInstanceOf(ProvidersConfigError);
    expect(error.message).not.toMatch(/sk-/i);
    expect(error.issues.some((issue) => issue.message.includes('密钥'))).toBe(true);
  });

  it('未知 auth 时校验失败', () => {
    const error = capture(() =>
      parseProvidersConfig({
        ...validFile,
        providers: {
          custom: {
            auth: 'oauth',
            command: ['custom'],
          },
        },
      }),
    );

    expect(error).toBeInstanceOf(ProvidersConfigError);
    const text = error.issues.map((issue) => `${issue.path} ${issue.message}`).join('\n');
    expect(text).toMatch(/auth|discriminator|Invalid/i);
  });

  it('命令参数里的疑似密钥会被拒绝', () => {
    const error = capture(() =>
      parseProvidersConfig({
        ...validFile,
        providers: {
          codex: {
            auth: 'subscription',
            command: ['codex', 'sk-example'],
            safe_mode: '--sandbox read-only',
          },
        },
      }),
    );

    expect(error.issues.some((issue) => issue.message.includes('密钥'))).toBe(true);
    expect(error.message).not.toMatch(/sk-/i);
  });

  it('configs/providers.yaml 通过校验', () => {
    const filePath = path.join(repoRoot, 'configs', 'providers.yaml');
    const config = loadProvidersConfig(filePath);
    const raw = parse(readFileSync(filePath, 'utf8')) as { providers: Record<string, unknown> };

    expect(config.version).toBe(1);
    expect(config.defaults.timeout_ms).toBe(180000);
    expect(config.providers.codex?.auth).toBe('subscription');
    expect(config.providers.codebuddy?.auth).toBe('subscription');
    expect(config.providers.hermes?.auth).toBe('subscription');
    expect(config.providers.openclaw?.auth).toBe('subscription');
    expect(config.providers.deepseek?.auth).toBe('api_key');
    expect(config.providers['ollama-local']?.auth).toBe('openai_compatible');
    expect(Object.keys(config.providers).sort()).toEqual(Object.keys(raw.providers).sort());

    for (const provider of Object.values(config.providers)) {
      if (provider.auth === 'subscription') {
        expect(provider.command.length).toBeGreaterThan(0);
        expect(provider.safe_mode.trim().length).toBeGreaterThan(0);
      }
      if (provider.auth === 'api_key') {
        expect(provider.key_env).toMatch(/^[A-Z][A-Z0-9_]*$/);
      }
      if (provider.auth === 'openai_compatible') {
        expect(provider.base_url.length).toBeGreaterThan(0);
        expect(provider.model.length).toBeGreaterThan(0);
      }
    }
  });
});

function capture(run: () => unknown): ProvidersConfigError {
  try {
    run();
  } catch (error) {
    if (error instanceof ProvidersConfigError) {
      return error;
    }
    throw error;
  }
  throw new Error('预期校验失败，但通过了');
}
