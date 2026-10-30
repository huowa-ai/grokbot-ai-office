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
    await expect(run([], repoRoot)).resolves.toBe(1);
  });

  it('run 在提供者不存在时打印 PROVIDER_NOT_FOUND', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await run(['missing-bot', '你好'], repoRoot);
    expect(code).toBe(1);
    expect(error.mock.calls.some((args) => String(args[0]).includes('PROVIDER_NOT_FOUND'))).toBe(
      true,
    );
  });

  it('run 对已登记提供者返回未实现错误而不编造回答', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await run(['codex', '你好'], repoRoot);
    expect(code).toBe(1);
    expect(log).not.toHaveBeenCalled();
    expect(error.mock.calls.some((args) => String(args[0]).includes('CLI_NOT_INSTALLED'))).toBe(
      true,
    );
  });
});
