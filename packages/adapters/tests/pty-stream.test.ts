import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { type PtySpawn, createAdapter } from '@grokbot-ai-office/adapters';
import { type RelayEvent, relay } from '@grokbot-ai-office/core';

const dirs: string[] = [];
const leftoverPids: number[] = [];

afterEach(() => {
  for (const pid of leftoverPids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch (error) {
      if (!isMissingProcess(error)) {
        throw error;
      }
    }
  }
  leftoverPids.length = 0;
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

describe('cli streaming and pty', () => {
  it('cli 适配器把延时写出的标准输出分成多段交给回调，最终文本不变', async () => {
    const script = [
      "const fs=require('fs');",
      "fs.writeSync(1,'AAA');",
      'setTimeout(()=>{',
      "fs.writeSync(1,'BBB');",
      "setTimeout(()=>fs.writeSync(1,'CCC'),80);",
      '},80);',
    ].join('');
    const chunks: string[] = [];
    const adapter = createAdapter(subscription(process.execPath, ['-e', script]), 'echo-bot', {
      workspace: tempDir(),
      env: process.env,
    });
    const text = await adapter.call(
      {
        provider: 'echo-bot',
        prompt: 'ignored',
        onOutputChunk: (chunk) => {
          chunks.push(chunk);
        },
      },
      new AbortController().signal,
    );

    expect(text).toBe('AAABBBCCC');
    expect(chunks.join('')).toBe('AAABBBCCC');
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('pty 模式原样转发转义序列，并在退出时结束进程组', async () => {
    const kills: number[] = [];
    const signals: string[] = [];
    const ptySpawn: PtySpawn = () => {
      let onData: (data: string) => void = () => {};
      let onExit: (event: { exitCode: number; signal?: number }) => void = () => {};
      return {
        pid: 424242,
        onData(callback) {
          onData = callback;
          queueMicrotask(() => onData('\u001b[31mred\u001b[0m'));
        },
        onExit(callback) {
          onExit = callback;
          queueMicrotask(() => onExit({ exitCode: 0 }));
        },
        write() {},
        kill(signal) {
          signals.push(signal ?? '');
        },
      };
    };
    const adapter = createAdapter(
      { ...subscription(process.execPath, ['-e', 'process.exit(0)']), pty: true },
      'pty-bot',
      {
        workspace: tempDir(),
        env: process.env,
        ptySpawn,
        killTree: (pid) => {
          kills.push(pid);
        },
      },
    );

    const text = await adapter.call(
      { provider: 'pty-bot', prompt: 'hi' },
      new AbortController().signal,
    );
    expect(text).toBe('\u001b[31mred\u001b[0m');
    expect(kills).toEqual([424242]);
    expect(signals).toContain('SIGKILL');
  });

  it('pty 加载失败时记录原因并回退到管道模式', async () => {
    const logs: string[] = [];
    const adapter = createAdapter(
      { ...subscription(process.execPath, ['-e', "process.stdout.write('pipe-ok')"]), pty: true },
      'fallback-bot',
      {
        workspace: tempDir(),
        env: process.env,
        log: (message) => {
          logs.push(message);
        },
        loadPty: async () => {
          throw new Error('missing module');
        },
      },
    );

    await expect(
      adapter.call({ provider: 'fallback-bot', prompt: 'x' }, new AbortController().signal),
    ).resolves.toBe('pipe-ok');
    expect(
      logs.some((line) => line.includes('回退到管道模式') && line.includes('missing module')),
    ).toBe(true);
  });

  it('中止时结束整个进程组，而不只是直接子进程', async () => {
    const script = [
      "const {spawn}=require('child_process');",
      `const child=spawn(${JSON.stringify(process.execPath)},['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});`,
      'process.stdout.write(String(child.pid));',
      'setInterval(()=>{},1000);',
    ].join('');
    const chunks: string[] = [];
    const adapter = createAdapter(subscription(process.execPath, ['-e', script]), 'tree-bot', {
      workspace: tempDir(),
      env: process.env,
    });
    const controller = new AbortController();
    const pending = adapter.call(
      {
        provider: 'tree-bot',
        prompt: 'x',
        onOutputChunk: (chunk) => {
          chunks.push(chunk);
        },
      },
      controller.signal,
    );
    const grandchild = await waitForPid(chunks);
    leftoverPids.push(grandchild);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' });
    await waitUntil(() => !isAlive(grandchild));
    expect(isAlive(grandchild)).toBe(false);
  });

  it('子进程退出后仍清掉它拉起的孙进程', async () => {
    const script = [
      "const {spawn}=require('child_process');",
      `const child=spawn(${JSON.stringify(process.execPath)},['-e','process.on("SIGHUP",()=>{});setInterval(()=>{},1000);'],{stdio:'ignore'});`,
      'child.unref();',
      'process.stdout.write(String(child.pid));',
    ].join('');
    const adapter = createAdapter(subscription(process.execPath, ['-e', script]), 'tree-exit', {
      workspace: tempDir(),
      env: process.env,
    });
    const text = await adapter.call(
      { provider: 'tree-exit', prompt: 'x' },
      new AbortController().signal,
    );
    const grandchild = Number(text.trim());
    expect(Number.isInteger(grandchild)).toBe(true);
    leftoverPids.push(grandchild);
    await waitUntil(() => !isAlive(grandchild));
    expect(isAlive(grandchild)).toBe(false);
  });

  it('relay 记录伪终端输出块且最终回答仍是完整原文', async () => {
    const events: RelayEvent[] = [];
    const ptySpawn: PtySpawn = () => ({
      pid: 515151,
      onData(callback) {
        queueMicrotask(() => callback('\u001b[32mhi\u001b[0m'));
      },
      onExit(callback) {
        queueMicrotask(() => callback({ exitCode: 0 }));
      },
      write() {},
      kill() {},
    });
    const result = await relay(
      { provider: 'pty-bot', prompt: 'hello' },
      {
        hasProvider: () => true,
        host: 'mac',
        promptPreviewChars: 0,
        events: {
          async emit(event) {
            events.push(event);
          },
        },
        resolveAdapter: () =>
          createAdapter(
            { ...subscription(process.execPath, ['-e', 'process.exit(0)']), pty: true },
            'pty-bot',
            {
              workspace: tempDir(),
              env: process.env,
              ptySpawn,
              killTree: () => {},
            },
          ),
      },
    );

    expect(result.text).toBe('\u001b[32mhi\u001b[0m');
    const chunk = events.find((event) => event.type === 'output_chunk');
    expect(chunk?.type === 'output_chunk' ? chunk.payload : undefined).toMatchObject({
      seq: 1,
      text: '\u001b[32mhi\u001b[0m',
    });
  });
});

function subscription(bin: string, args: string[]) {
  return {
    auth: 'subscription' as const,
    command: [bin, ...args],
    input: 'stdin' as const,
    safe_mode: args[0] ?? bin,
  };
}

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'pty-stream-'));
  dirs.push(dir);
  return dir;
}

async function waitForPid(chunks: string[]): Promise<number> {
  let pid = Number.NaN;
  await waitUntil(() => {
    pid = Number(chunks.join('').trim());
    return Number.isInteger(pid) && pid > 1;
  });
  return pid;
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 3000) {
      throw new Error('等待条件超时');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isMissingProcess(error)) {
      return false;
    }
    throw error;
  }
}

function isMissingProcess(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH';
}
