import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it } from 'vitest';

import type { AdapterPort } from '@grokbot-ai-office/core';
import {
  listApprovals,
  readStateChunkLimit,
  redactSecrets,
  reduceEvents,
} from '@grokbot-ai-office/core';
import { RelayError } from '@grokbot-ai-office/core';
import { readEvents } from '@grokbot-ai-office/events';

import { type RelayMcpOptions, createRelayMcpServer } from '../src/index.js';

const secret = ['sk', 'supersecretvalue'].join('-');
const dirs: string[] = [];
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of closers.splice(0)) {
    await close();
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('mcp tools', () => {
  it('listTools 公布 ask、list_agents、office_status 以及交接和批准', async () => {
    const client = await connect(baseOptions());
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();
    expect(names).toEqual([
      'approval_list',
      'approval_request',
      'approval_resolve',
      'ask',
      'handoff',
      'list_agents',
      'office_status',
    ]);

    const ask = listed.tools.find((tool) => tool.name === 'ask');
    const schema = ask?.inputSchema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(schema.properties).toMatchObject({
      provider: expect.any(Object),
      prompt: expect.any(Object),
      taskId: expect.any(Object),
    });
    expect(schema.required ?? []).toEqual(expect.arrayContaining(['provider', 'prompt']));
    expect(schema.required ?? []).not.toContain('taskId');
    expect(ask?.description).toContain('不会执行命令');
  });

  it('ask 在提供者未登记时返回 PROVIDER_NOT_FOUND 且不调用适配器', async () => {
    const calls = { n: 0 };
    const client = await connect(baseOptions(fakeAdapter(calls)));
    const result = await client.callTool({
      name: 'ask',
      arguments: { provider: 'missing-bot', prompt: '你好' },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('PROVIDER_NOT_FOUND');
    expect(calls.n).toBe(0);
    expect(await readEvents(eventsPath())).toEqual([]);
    expect(existsSync(path.join(workspaceOf(), 'RAN.txt'))).toBe(false);
  });

  it('ask 在参数像命令时由 schema 拒绝且不调用适配器', async () => {
    const calls = { n: 0 };
    const client = await connect(baseOptions(fakeAdapter(calls)));
    const result = await client.callTool({
      name: 'ask',
      arguments: { provider: 'echo; rm -rf /', prompt: '你好' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Invalid arguments/);
    expect(textOf(result)).not.toContain('rm -rf');
    expect(calls.n).toBe(0);
    expect(existsSync(path.join(workspaceOf(), 'RAN.txt'))).toBe(false);
  });

  it('ask 在当前主机不可用时拒绝调用', async () => {
    const calls = { n: 0 };
    const client = await connect(baseOptions(fakeAdapter(calls)));
    const result = await client.callTool({
      name: 'ask',
      arguments: { provider: 'cloud-only', prompt: '你好' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('CONFIG_INVALID');
    expect(calls.n).toBe(0);
  });

  it('ask 成功时返回文本、实例和 taskId，并写入 v1 事件和进度', async () => {
    const calls = { n: 0 };
    const seen: string[] = [];
    const client = await connect(
      baseOptions({
        kind: 'http',
        async call(req) {
          calls.n += 1;
          seen.push(req.prompt);
          await req.onOutputChunk?.(`hello ${secret}`);
          await req.onOutputChunk?.(' tail');
          return `done ${secret}`;
        },
        async selfcheck() {
          return { ok: true, detail: 'fake' };
        },
      }),
    );
    const notes: string[] = [];
    const result = await client.callTool(
      {
        name: 'ask',
        arguments: { provider: 'echo', prompt: `please ${secret}`, taskId: 'task-1' },
      },
      CallToolResultSchema,
      {
        onprogress: (progress) => {
          notes.push(progress.message ?? '');
        },
      },
    );

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      text: 'done [REDACTED]',
      instance: 'echo@mac',
      taskId: 'task-1',
    });
    expect(calls.n).toBe(1);
    expect(seen).toEqual([`please ${secret}`]);
    expect(notes.join('\n')).not.toContain(secret);
    expect(notes.some((note) => note.includes('[REDACTED]'))).toBe(true);
    expect(JSON.stringify(result)).not.toContain(secret);

    const events = await readEvents(eventsPath());
    expect(events.map((event) => event.type)).toEqual([
      'started',
      'status',
      'output_chunk',
      'output_chunk',
      'done',
      'status',
    ]);
    expect(events.every((event) => event.v === 1 && event.taskId === 'task-1')).toBe(true);
    expect(events.every((event) => event.instance === 'echo@mac')).toBe(true);
    expect(JSON.stringify(events)).not.toContain(secret);
    expect(existsSync(path.join(workspaceOf(), 'RAN.txt'))).toBe(false);
  });

  it('ask 把适配器的 RelayError 映射成工具错误并打码', async () => {
    const client = await connect(
      baseOptions({
        kind: 'http',
        async call() {
          throw new RelayError('AUTH_MISSING', `缺少 ${secret}`);
        },
        async selfcheck() {
          return { ok: true, detail: 'fake' };
        },
      }),
    );
    const result = await client.callTool({
      name: 'ask',
      arguments: { provider: 'echo', prompt: '你好' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('AUTH_MISSING');
    expect(textOf(result)).not.toContain(secret);
    expect(textOf(result)).toContain('[REDACTED]');

    const events = await readEvents(eventsPath());
    expect(events.map((event) => event.type)).toEqual(['started', 'status', 'error', 'status']);
    expect(events.at(-1)).toMatchObject({
      type: 'status',
      payload: { state: 'stuck', code: 'AUTH_MISSING' },
    });
    expect(JSON.stringify(events)).not.toContain(secret);
  });

  it('list_agents 返回接入方式、hosts、实例名和本机是否可用', async () => {
    const client = await connect(baseOptions());
    const result = await client.callTool({ name: 'list_agents', arguments: {} });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      host: 'mac',
      agents: [
        {
          name: 'anywhere',
          auth: 'subscription',
          hosts: null,
          instance: 'anywhere@mac',
          usable: true,
        },
        {
          name: 'cloud-only',
          auth: 'openai_compatible',
          hosts: ['cloud'],
          instance: 'cloud-only@mac',
          usable: false,
        },
        {
          name: 'echo',
          auth: 'api_key',
          hosts: ['mac'],
          instance: 'echo@mac',
          usable: true,
        },
      ],
    });
    const encoded = JSON.stringify(result.structuredContent);
    expect(encoded).not.toContain('EXAMPLE_API_KEY');
    expect(encoded).not.toContain('RAN.txt');
    expect(encoded).not.toContain('process.exit');
  });

  it('office_status 与事件归约一致，并带上待批准事项', async () => {
    const client = await connect(baseOptions(fakeAdapter({ n: 0 }, 'visible answer')));
    await client.callTool({
      name: 'ask',
      arguments: { provider: 'echo', prompt: '你好', taskId: 'task-9' },
    });
    const requested = await client.callTool({
      name: 'approval_request',
      arguments: { instance: 'echo@mac', summary: `允许 ${secret}` },
    });
    expect(requested.isError).toBeUndefined();

    const result = await client.callTool({ name: 'office_status', arguments: {} });
    const body = result.structuredContent as {
      v: number;
      instances: unknown;
      pendingApprovals: Array<{ summary: string; status: string }>;
    };
    const events = await readEvents(eventsPath());
    const reduced = reduceEvents(events, { chunkLimit: readStateChunkLimit(env()) });
    expect(body.v).toBe(1);
    expect(body.instances).toEqual(
      reduced.instances.map((item) => ({
        ...item,
        ...(item.taskPreview === undefined ? {} : { taskPreview: redactSecrets(item.taskPreview) }),
        terminalTail: redactSecrets(item.terminalTail),
      })),
    );
    const pending = listApprovals(events).filter((record) => record.status === 'pending');
    expect(body.pendingApprovals).toHaveLength(1);
    expect(body.pendingApprovals[0]?.status).toBe('pending');
    expect(body.pendingApprovals[0]?.summary).toBe(redactSecrets(pending[0]?.summary ?? ''));
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('handoff 与 approval_resolve 走 core 的同一套函数', async () => {
    const root = workspaceOf();
    writeFileSync(path.join(root, 'draft.txt'), '草稿');
    const client = await connect(baseOptions());
    const handed = await client.callTool({
      name: 'handoff',
      arguments: {
        from: 'echo@mac',
        to: 'anywhere@cloud',
        filePath: 'draft.txt',
        note: '请继续',
      },
    });
    expect(handed.structuredContent).toEqual({
      relativePath: 'outbox/anywhere@cloud/draft.txt',
    });
    expect(existsSync(path.join(root, 'outbox', 'anywhere@cloud', 'draft.txt'))).toBe(true);

    const requested = await client.callTool({
      name: 'approval_request',
      arguments: { instance: 'echo@mac', summary: '允许读取仓库' },
    });
    const approvalId = (requested.structuredContent as { approvalId: string }).approvalId;
    const resolved = await client.callTool({
      name: 'approval_resolve',
      arguments: { approvalId, approved: false },
    });
    expect(resolved.structuredContent).toMatchObject({
      approvalId,
      approved: false,
      instance: 'echo@mac',
    });
    const listed = await client.callTool({ name: 'approval_list', arguments: {} });
    expect(listed.structuredContent).toMatchObject({
      approvals: [expect.objectContaining({ id: approvalId, status: 'denied' })],
    });
  });
});

function fakeAdapter(calls: { n: number }, text = 'ok'): AdapterPort {
  return {
    kind: 'http',
    async call(req) {
      calls.n += 1;
      await req.onOutputChunk?.(text);
      return text;
    },
    async selfcheck() {
      return { ok: true, detail: 'fake' };
    },
  };
}

function baseOptions(adapter?: AdapterPort): RelayMcpOptions {
  return {
    cwd: workspaceOf(),
    env: env(),
    resolveAdapter: () => adapter,
  };
}

const roots = new Map<string, { workspace: string; events: string }>();

function workspaceOf(): string {
  return paths().workspace;
}

function eventsPath(): string {
  return paths().events;
}

function env(): NodeJS.ProcessEnv {
  const pathsForTest = paths();
  return {
    PATH: process.env.PATH,
    RELAY_HOST: 'mac',
    RELAY_WORKSPACE: pathsForTest.workspace,
    RELAY_EVENTS_PATH: pathsForTest.events,
  };
}

function paths(): { workspace: string; events: string } {
  const current = expect.getState().currentTestName ?? 'mcp';
  const existing = roots.get(current);
  if (existing) {
    return existing;
  }
  const workspace = mkdtempSync(path.join(tmpdir(), 'mcp-relay-'));
  dirs.push(workspace);
  mkdirSync(path.join(workspace, 'configs'));
  writeFileSync(path.join(workspace, 'configs', 'providers.yaml'), providersYaml());
  const events = path.join(workspace, 'events.jsonl');
  const created = { workspace, events };
  roots.set(current, created);
  return created;
}

function providersYaml(): string {
  return `
version: 1
defaults:
  timeout_ms: 5000
providers:
  echo:
    auth: api_key
    vendor: deepseek
    model: demo
    key_env: EXAMPLE_API_KEY
    hosts: ["mac"]
  cloud-only:
    auth: openai_compatible
    base_url: http://127.0.0.1:9/v1
    model: demo
    hosts: ["cloud"]
  anywhere:
    auth: subscription
    command: ["node", "-e", "require('fs').writeFileSync('RAN.txt','x')"]
    input: arg
    safe_mode: "-e"
`.trimStart();
}

async function connect(options: RelayMcpOptions): Promise<Client> {
  const server = createRelayMcpServer(options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'relay-test', version: '0.0.0' });
  await client.connect(clientTransport);
  closers.push(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

function textOf(result: { content?: Array<{ type: string; text?: string }> }): string {
  return (result.content ?? []).map((item) => item.text ?? '').join('');
}
