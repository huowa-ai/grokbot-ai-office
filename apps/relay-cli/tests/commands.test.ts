import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import { readEvents } from '@grokbot-ai-office/events';

import { run } from '../src/main.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

describe('ai-relay commands', () => {
  it('handoff 把文件放进 outbox 并记录事件', async () => {
    const workspace = tempDir();
    const events = path.join(tempDir(), 'events.jsonl');
    writeFileSync(path.join(workspace, 'draft.txt'), '草稿');
    const stdout: string[] = [];
    const code = await run(
      ['handoff', 'codex@mac', 'deepseek@cloud', path.join(workspace, 'draft.txt'), '请看'],
      workspace,
      env(workspace, events),
      {
        stdout: (text) => stdout.push(text),
      },
    );

    expect(code).toBe(0);
    expect(stdout).toEqual(['outbox/deepseek@cloud/draft.txt']);
    expect(
      readFileSync(path.join(workspace, 'outbox', 'deepseek@cloud', 'draft.txt'), 'utf8'),
    ).toBe('草稿');
    const logged = await readEvents(events);
    expect(logged[0]).toMatchObject({
      type: 'status',
      payload: { state: 'handoff', filePath: 'outbox/deepseek@cloud/draft.txt' },
    });
  });

  it('approval request、list、resolve 覆盖一次批准', async () => {
    const workspace = tempDir();
    const events = path.join(tempDir(), 'events.jsonl');
    const stdout: string[] = [];
    const io = {
      stdout: (text: string) => stdout.push(text),
    };
    expect(
      await run(
        ['approval', 'request', 'claude@mac', '允许读取仓库'],
        workspace,
        env(workspace, events),
        io,
      ),
    ).toBe(0);
    const approvalId = stdout.at(-1);
    expect(approvalId?.startsWith('appr_')).toBe(true);

    expect(await run(['approval', 'list'], workspace, env(workspace, events), io)).toBe(0);
    expect(stdout.some((line) => line.includes('pending') && line.includes('允许读取仓库'))).toBe(
      true,
    );

    expect(
      await run(
        ['approval', 'resolve', approvalId ?? '', 'false'],
        workspace,
        env(workspace, events),
        io,
      ),
    ).toBe(0);
    expect(stdout.at(-1)).toBe('denied');
  });

  it('hook 从参数和标准输入写入状态，且不回显提示', async () => {
    const workspace = tempDir();
    const events = path.join(tempDir(), 'events.jsonl');
    const stderr: string[] = [];
    const marker = '这是一段不该落盘的长提示';
    const code = await run(
      ['hook', 'permission_request', '--instance', 'claude@mac'],
      workspace,
      env(workspace, events),
      {
        stdin: Readable.from([
          JSON.stringify({
            hook_event_name: 'PermissionRequest',
            prompt: `${'前'.repeat(40)}${marker}`,
            tool_name: 'Bash',
          }),
        ]),
        isTTY: false,
        stderr: (text) => stderr.push(text),
      },
    );

    expect(code).toBe(0);
    expect(stderr).toEqual([]);
    const logged = await readEvents(events);
    expect(logged[0]).toMatchObject({
      type: 'status',
      instance: 'claude@mac',
      payload: { state: 'waiting_approval', source: 'hook', summary: 'Bash' },
    });
    expect(JSON.stringify(logged)).not.toContain(marker);
  });

  it('mcp --http 在缺少令牌时拒绝监听 0.0.0.0', async () => {
    const stderr: string[] = [];
    const code = await run(
      ['mcp', '--http', '--host', '0.0.0.0', '--port', '0'],
      tempDir(),
      { RELAY_EVENTS_PATH: path.join(tempDir(), 'events.jsonl') },
      { stderr: (text) => stderr.push(text) },
    );
    expect(code).toBe(1);
    expect(
      stderr.some((line) => line.includes('CONFIG_INVALID') && line.includes('RELAY_SERVER_TOKEN')),
    ).toBe(true);
  });

  it('mcp --http 监听本机后可以停止', async () => {
    const controller = new AbortController();
    const stdout: string[] = [];
    const code = await run(
      ['mcp', '--http', '--port', '0'],
      tempDir(),
      { RELAY_EVENTS_PATH: path.join(tempDir(), 'events.jsonl') },
      {
        stdout: (text) => {
          stdout.push(text);
          controller.abort();
        },
        signal: controller.signal,
      },
    );
    expect(code).toBe(0);
    expect(stdout[0]).toMatch(/^MCP 服务已监听 http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  });

  it('mcp 在 stdio 模式收到 --port 时返回 CONFIG_INVALID', async () => {
    const stderr: string[] = [];
    const code = await run(
      ['mcp', '--port', '8788'],
      tempDir(),
      {},
      {
        stderr: (text) => stderr.push(text),
      },
    );
    expect(code).toBe(1);
    expect(stderr.some((line) => line.includes('CONFIG_INVALID'))).toBe(true);
  });

  it('office 在没有页面时返回 CONFIG_INVALID', async () => {
    const stderr: string[] = [];
    const code = await run(
      ['office'],
      tempDir(),
      { RELAY_OFFICE_DIST: tempDir() },
      { stderr: (text) => stderr.push(text) },
    );
    expect(code).toBe(1);
    expect(
      stderr.some((line) => line.includes('CONFIG_INVALID') && line.includes('办公室页面')),
    ).toBe(true);
  });

  it('office --demo 打印带演示查询的本机地址', async () => {
    const root = tempDir();
    writeFileSync(path.join(root, 'index.html'), '<p>办公室</p>');
    const controller = new AbortController();
    const stdout: string[] = [];
    const code = await run(
      ['office', '--port', '0', '--demo'],
      tempDir(),
      { RELAY_OFFICE_DIST: root },
      {
        stdout: (text) => {
          stdout.push(text);
          controller.abort();
        },
        signal: controller.signal,
      },
    );
    expect(code).toBe(0);
    expect(stdout[0]).toMatch(/^办公室已打开 http:\/\/127\.0\.0\.1:\d+\/\?demo=1$/);
  });

  it('serve 在缺少令牌时拒绝监听 0.0.0.0', async () => {
    const stderr: string[] = [];
    const code = await run(
      ['serve', '--host', '0.0.0.0', '--port', '0'],
      tempDir(),
      {
        RELAY_EVENTS_PATH: path.join(tempDir(), 'events.jsonl'),
      },
      {
        stderr: (text) => stderr.push(text),
      },
    );
    expect(code).toBe(1);
    expect(
      stderr.some((line) => line.includes('CONFIG_INVALID') && line.includes('RELAY_SERVER_TOKEN')),
    ).toBe(true);
  });
});

function env(workspace: string, events: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    RELAY_WORKSPACE: workspace,
    RELAY_EVENTS_PATH: events,
    RELAY_HOST: 'mac',
  };
}

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'relay-cmd-'));
  dirs.push(dir);
  return dir;
}
