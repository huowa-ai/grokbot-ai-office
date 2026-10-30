import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { type RelayEvent, createEvent } from '@grokbot-ai-office/core';
import { startEventServer } from '@grokbot-ai-office/event-server';
import { createJsonlEventSink } from '@grokbot-ai-office/events';

const dirs: string[] = [];
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of closers) {
    await close();
  }
  closers.length = 0;
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

describe('event server', () => {
  it('startEventServer 用快照接待后加入的客户端，并用 WebSocket 广播新事件', async () => {
    const file = tempFile();
    const sink = createJsonlEventSink(file);
    await sink.emit(chunk('codex@mac', 1, 'hello'));
    const server = await startEventServer({
      eventsPath: file,
      host: '127.0.0.1',
      port: 0,
      pollMs: 30,
    });
    closers.push(() => server.close());

    const state = (await (await fetch(`${server.url}/state`)).json()) as {
      instances: Array<{
        instance: string;
        status: string;
        terminalTail: string;
        chunks: unknown[];
      }>;
    };
    expect(state.instances[0]).toMatchObject({
      instance: 'codex@mac',
      terminalTail: 'hello',
    });
    expect(state.instances[0]?.chunks).toHaveLength(1);

    const messages: RelayEvent[] = [];
    const socket = new WebSocket(`${server.url.replace('http://', 'ws://')}/events`);
    await onceOpen(socket);
    socket.addEventListener('message', (event) => {
      messages.push(JSON.parse(String(event.data)) as RelayEvent);
    });
    await sink.emit(chunk('codex@mac', 2, 'world'));
    await waitUntil(() => messages.length > 0);
    expect(messages[0]).toMatchObject({
      type: 'output_chunk',
      payload: { seq: 2, text: 'world' },
    });
    socket.close();

    const later = (await (await fetch(`${server.url}/state?instance=codex@mac`)).json()) as {
      instances: Array<{ terminalTail: string }>;
    };
    expect(later.instances[0]?.terminalTail).toBe('helloworld');
  });

  it('POST /hook 写入状态且不提供运行 AI 的入口', async () => {
    const file = tempFile();
    const server = await startEventServer({
      eventsPath: file,
      host: '127.0.0.1',
      port: 0,
      pollMs: 30,
      token: 'local-token',
    });
    closers.push(() => server.close());

    const denied = await fetch(`${server.url}/state`);
    expect(denied.status).toBe(401);

    const missing = await fetch(`${server.url}/run`, {
      method: 'POST',
      headers: { authorization: 'Bearer local-token' },
      body: '{}',
    });
    expect(missing.status).toBe(404);

    const hooked = await fetch(`${server.url}/hook`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer local-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        event: 'PermissionRequest',
        instance: 'claude@mac',
        tool_name: 'Bash',
      }),
    });
    expect(hooked.status).toBe(200);
    const body = (await hooked.json()) as { ok: boolean; status: string };
    expect(body).toMatchObject({ ok: true, status: 'waiting_approval' });

    const sink = createJsonlEventSink(file);
    await sink.emit(
      createEvent({
        v: 1,
        id: 'heur-1',
        ts: '2026-10-30T00:00:01.000Z',
        type: 'status',
        instance: 'claude@mac',
        provider: 'claude',
        host: 'mac',
        payload: {
          state: 'working',
          source: 'heuristic',
          taskPreview: 'guess',
        },
      }),
    );
    await sink.emit(chunk('claude@mac', 1, 'seen'));

    await waitUntil(async () => {
      const response = await fetch(`${server.url}/state`, {
        headers: { authorization: 'Bearer local-token' },
      });
      const snapshot = (await response.json()) as {
        instances: Array<{ status: string; hookActive: boolean; terminalTail: string }>;
      };
      const instance = snapshot.instances[0];
      return (
        instance?.terminalTail === 'seen' &&
        instance.status === 'waiting_approval' &&
        instance.hookActive
      );
    });
  });

  it('startEventServer 在非本机地址缺少令牌时拒绝启动', async () => {
    await expect(
      startEventServer({
        eventsPath: tempFile(),
        host: '0.0.0.0',
        port: 0,
      }),
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
  });
});

function chunk(instance: string, seq: number, text: string): RelayEvent {
  const [provider, host] = instance.split('@');
  return createEvent({
    v: 1,
    id: `chunk-${seq}`,
    ts: '2026-10-30T00:00:00.000Z',
    type: 'output_chunk',
    instance,
    provider: provider ?? 'codex',
    host: host ?? 'mac',
    taskId: 'task-1',
    payload: { seq, text },
  });
}

function tempFile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'event-server-'));
  dirs.push(dir);
  return path.join(dir, 'events.jsonl');
}

function onceOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('WebSocket 连接失败')), { once: true });
  });
}

async function waitUntil(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const started = Date.now();
  while (!(await predicate())) {
    if (Date.now() - started > 3000) {
      throw new Error('等待条件超时');
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}
