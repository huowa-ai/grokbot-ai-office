import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runSelfcheck } from '../src/selfcheck.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

describe('runSelfcheck', () => {
  it('runSelfcheck 为每个提供者打印通过、失败和跳过', async () => {
    const dir = writeConfig(`
version: 1
defaults:
  timeout_ms: 1000
providers:
  echo-bot:
    auth: subscription
    command: ["node", "-e", "process.exit(0)"]
    safe_mode: "-e"
  missing-bot:
    auth: subscription
    command: ["definitely-missing-bin-xyz"]
    safe_mode: "definitely-missing-bin-xyz"
  deepseek:
    auth: api_key
    vendor: deepseek
    model: deepseek-chat
    key_env: DEEPSEEK_API_KEY
  local-only:
    auth: openai_compatible
    base_url: http://127.0.0.1:9/v1
    model: demo
    key_env: null
    hosts: ["cloud"]
`);
    const lines: string[] = [];
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      seen.push(String(input));
      return new Response('ok', { status: 200 });
    };

    const code = await runSelfcheck({
      cwd: dir,
      env: testEnv({ RELAY_HOST: 'mac', DEEPSEEK_API_KEY: 'test-key' }),
      fetchImpl,
      io: {
        stdout: (text) => {
          lines.push(text);
        },
      },
    });

    const table = lines.join('\n');
    expect(code).toBe(1);
    expect(table).toContain('echo-bot');
    expect(table).toContain('通过');
    expect(table).toContain('missing-bot');
    expect(table).toContain('未找到命令 definitely-missing-bin-xyz');
    expect(table).toContain('deepseek');
    expect(table).toContain('已设置 DEEPSEEK_API_KEY');
    expect(table).toContain('local-only');
    expect(table).toContain('跳过');
    expect(seen).toEqual(['https://api.deepseek.com']);
    expect(table).not.toContain('test-key');
  });

  it('runSelfcheck 在名字不存在时返回 PROVIDER_NOT_FOUND', async () => {
    const dir = writeConfig(`
version: 1
defaults:
  timeout_ms: 1000
providers:
  echo-bot:
    auth: subscription
    command: ["node", "-e", "process.exit(0)"]
    safe_mode: "-e"
`);
    const errors: string[] = [];
    const code = await runSelfcheck({
      name: 'missing',
      cwd: dir,
      env: testEnv(),
      io: {
        stderr: (text) => {
          errors.push(text);
        },
        stdout: () => {},
      },
    });
    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('PROVIDER_NOT_FOUND');
  });
});

function writeConfig(yaml: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'relay-selfcheck-'));
  dirs.push(dir);
  mkdirSync(path.join(dir, 'configs'));
  writeFileSync(path.join(dir, 'configs', 'providers.yaml'), yaml.trimStart());
  return dir;
}

function testEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR']) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return { ...env, ...extra };
}
