import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { run } from '../src/main.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('run', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('run 在参数不足时返回非零码', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(run([], repoRoot, {})).resolves.toBe(1);
  });

  it('run 在提供者不存在时打印 PROVIDER_NOT_FOUND', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await run(['missing-bot', '你好'], repoRoot, {});
    expect(code).toBe(1);
    expect(error.mock.calls.some((args) => String(args[0]).includes('PROVIDER_NOT_FOUND'))).toBe(
      true,
    );
  });

  it('run 对已登记提供者返回未实现错误而不编造回答', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await run(['codex', '你好'], repoRoot, { RELAY_HOST: 'mac' });
    expect(code).toBe(1);
    expect(log).not.toHaveBeenCalled();
    expect(error.mock.calls.some((args) => String(args[0]).includes('CLI_NOT_INSTALLED'))).toBe(
      true,
    );
  });

  it('run 在 RELAY_HOST 不合法时返回 CONFIG_INVALID', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await run(['codex', '你好'], repoRoot, { RELAY_HOST: 'Mac' });
    expect(code).toBe(1);
    expect(error.mock.calls.some((args) => String(args[0]).includes('CONFIG_INVALID'))).toBe(true);
    expect(error.mock.calls.some((args) => String(args[0]).includes('Mac'))).toBe(false);
  });

  it('run 在当前主机不在 hosts 中时拒绝调用', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'relay-host-'));
    mkdirSync(path.join(dir, 'configs'));
    writeFileSync(
      path.join(dir, 'configs', 'providers.yaml'),
      [
        'version: 1',
        'defaults:',
        '  timeout_ms: 1000',
        'providers:',
        '  codex:',
        '    auth: subscription',
        '    command: ["echo"]',
        '    safe_mode: "--sandbox read-only"',
        '    hosts: ["cloud"]',
        '',
      ].join('\n'),
    );
    try {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const code = await run(['codex', '你好'], dir, { RELAY_HOST: 'mac' });
      expect(code).toBe(1);
      expect(error.mock.calls.some((args) => String(args[0]).includes('主机 mac'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
