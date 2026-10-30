import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createAdapter } from '@grokbot-ai-office/adapters';
import { RelayError, relay } from '@grokbot-ai-office/core';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

describe('cli adapter', () => {
  it('cli 适配器在 stdin 模式下原样返回命令输出并创建工作目录', async () => {
    const workspace = tempDir();
    const adapter = adapterFor(
      {
        command: [
          'node',
          '-e',
          'let data = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", (chunk) => { data += chunk; }); process.stdin.on("end", () => { process.stdout.write(data); });',
        ],
        input: 'stdin',
      },
      workspace,
    );

    const text = await adapter.call(
      { provider: 'echo-bot', prompt: '来自标准输入' },
      new AbortController().signal,
    );

    expect(text).toBe('来自标准输入');
    expect(existsSync(path.join(workspace, 'shared'))).toBe(true);
    expect(existsSync(path.join(workspace, 'agents', 'echo-bot'))).toBe(true);
    expect(existsSync(path.join(workspace, 'outbox'))).toBe(true);
  });

  it('cli 适配器在 arg 模式下把提示追加为参数', async () => {
    const adapter = adapterFor(
      {
        command: ['node', '-e', 'process.stdout.write(process.argv.at(-1) ?? "")'],
        input: 'arg',
      },
      tempDir(),
    );

    await expect(
      adapter.call({ provider: 'echo-bot', prompt: '参数提示' }, new AbortController().signal),
    ).resolves.toBe('参数提示');
  });

  it('cli 适配器在 file 模式下替换 {file} 并在结束后删除提示文件', async () => {
    const workspace = tempDir();
    const adapter = adapterFor(
      {
        command: [
          'node',
          '-e',
          'process.stdout.write(require("fs").readFileSync(process.argv.at(-1), "utf8"))',
          '{file}',
        ],
        input: 'file',
      },
      workspace,
    );

    await expect(
      adapter.call({ provider: 'echo-bot', prompt: '文件提示' }, new AbortController().signal),
    ).resolves.toBe('文件提示');

    const leftovers = readdirSync(path.join(workspace, 'agents', 'echo-bot')).filter((name) =>
      name.startsWith('prompt-'),
    );
    expect(leftovers).toEqual([]);
  });

  it('cli 适配器能执行 echo', async () => {
    const adapter = adapterFor(
      {
        command: ['echo', 'hello-from-echo'],
        input: 'stdin',
        safeMode: 'echo',
      },
      tempDir(),
    );

    const text = await adapter.call(
      { provider: 'echo-bot', prompt: 'ignored' },
      new AbortController().signal,
    );
    expect(text.trim()).toBe('hello-from-echo');
  });

  it('cli 适配器按 output_filter 去掉匹配行', async () => {
    const adapter = adapterFor(
      {
        command: ['node', '-e', 'process.stdout.write("[log] noise\\nhello\\n")'],
        input: 'stdin',
        outputFilter: '^\\[',
      },
      tempDir(),
    );

    const text = await adapter.call(
      { provider: 'echo-bot', prompt: '' },
      new AbortController().signal,
    );
    expect(text.trim()).toBe('hello');
  });

  it('cli 适配器在非零退出时返回 CLI_EXIT_NONZERO 并脱敏 stderr', async () => {
    const secret = ['sk', 'supersecretvalue'].join('-');
    const adapter = adapterFor(
      {
        command: [
          'node',
          '-e',
          `process.stderr.write(${JSON.stringify(`${secret}\n`)}); process.exit(2)`,
        ],
        input: 'stdin',
      },
      tempDir(),
    );

    const error = await capture(() =>
      adapter.call({ provider: 'echo-bot', prompt: 'hi' }, new AbortController().signal),
    );

    expect(error).toBeInstanceOf(RelayError);
    expect(error.code).toBe('CLI_EXIT_NONZERO');
    expect(error.message).toContain('[REDACTED]');
    expect(error.message).not.toContain(secret);
    expect(String(error.cause)).not.toContain(secret);
  });

  it('cli 适配器在命令不存在时返回 CLI_NOT_INSTALLED', async () => {
    const adapter = adapterFor(
      {
        command: ['definitely-missing-bin-xyz'],
        input: 'stdin',
        safeMode: 'definitely-missing-bin-xyz',
      },
      tempDir(),
    );

    const error = await capture(() =>
      adapter.call({ provider: 'echo-bot', prompt: 'hi' }, new AbortController().signal),
    );
    expect(error.code).toBe('CLI_NOT_INSTALLED');
  });

  it('cli 适配器在中止时返回 TIMEOUT', async () => {
    const adapter = adapterFor(
      {
        command: [
          'node',
          '-e',
          'setInterval(() => {}, 1000); setTimeout(() => process.exit(0), 3000)',
        ],
        input: 'stdin',
      },
      tempDir(),
    );
    const controller = new AbortController();
    const pending = adapter.call({ provider: 'echo-bot', prompt: 'hi' }, controller.signal);
    const timer = setTimeout(() => controller.abort(), 40);

    try {
      const error = await pending.then(
        () => {
          throw new Error('命令没有被中止');
        },
        (error: unknown) => error,
      );
      expect(error).toBeInstanceOf(RelayError);
      if (error instanceof RelayError) {
        expect(error.code).toBe('TIMEOUT');
      }
    } finally {
      clearTimeout(timer);
    }
  });

  it('relay 在 CLI 适配器超时后返回 TIMEOUT', async () => {
    const adapter = adapterFor(
      {
        command: [
          'node',
          '-e',
          'setInterval(() => {}, 1000); setTimeout(() => process.exit(0), 3000)',
        ],
        input: 'stdin',
      },
      tempDir(),
    );

    const result = await relay(
      { provider: 'echo-bot', prompt: 'hi', timeoutMs: 80 },
      {
        hasProvider: () => true,
        resolveAdapter: () => adapter,
      },
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('TIMEOUT');
  });

  it('cli 适配器在命令未包含 safe_mode 时拒绝执行', async () => {
    const adapter = adapterFor(
      {
        command: ['node', '-e', 'process.stdout.write("ran")'],
        input: 'stdin',
        safeMode: '--sandbox',
      },
      tempDir(),
    );

    const error = await capture(() =>
      adapter.call({ provider: 'echo-bot', prompt: 'hi' }, new AbortController().signal),
    );
    expect(error.code).toBe('CONFIG_INVALID');
    expect(error.message).not.toContain('ran');
  });

  it('cli 适配器 selfcheck 能区分已安装和缺失的命令', async () => {
    const workspace = tempDir();
    const present = adapterFor(
      { command: ['node', '-e', 'process.exit(0)'], input: 'stdin' },
      workspace,
    );
    const missing = adapterFor(
      {
        command: ['definitely-missing-bin-xyz'],
        input: 'stdin',
        safeMode: 'definitely-missing-bin-xyz',
      },
      workspace,
    );

    await expect(present.selfcheck()).resolves.toMatchObject({
      ok: true,
      detail: '已找到命令 node',
    });
    await expect(missing.selfcheck()).resolves.toMatchObject({ ok: false });
  });
});

function adapterFor(
  options: {
    command: string[];
    input: 'stdin' | 'arg' | 'file';
    safeMode?: string;
    outputFilter?: string;
  },
  workspace: string,
) {
  return createAdapter(
    {
      auth: 'subscription',
      command: options.command,
      input: options.input,
      safe_mode: options.safeMode ?? '-e',
      output_filter: options.outputFilter,
    },
    'echo-bot',
    { env: testEnv(), workspace },
  );
}

function testEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR']) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'relay-cli-adapter-'));
  dirs.push(dir);
  return dir;
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
