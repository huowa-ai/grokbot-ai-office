import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it } from 'vitest';

import { RelayError } from '@grokbot-ai-office/core';

import { assertMcpBind, resolveMcpBind, startMcpHttp } from '../src/index.js';

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

describe('mcp http auth', () => {
  it('resolveMcpBind 默认绑定本机 8788，非本机没有令牌时拒绝', () => {
    expect(resolveMcpBind({})).toEqual({ host: '127.0.0.1', port: 8788 });
    expect(resolveMcpBind({ RELAY_MCP_PORT: '8790' }).port).toBe(8790);
    expect(resolveMcpBind({ RELAY_SERVER_HOST: '0.0.0.0' }).host).toBe('0.0.0.0');
    expect(() => assertMcpBind('0.0.0.0', undefined)).toThrow(RelayError);
    expect(() => resolveMcpBind({ RELAY_MCP_PORT: 'nope' })).toThrow(RelayError);
  });

  it('startMcpHttp 在非本机地址缺少令牌时拒绝启动', async () => {
    await expect(
      startMcpHttp({
        env: {},
        host: '0.0.0.0',
        port: 0,
        cwd: tempDir(),
      }),
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
  });

  it('startMcpHttp 在本机且未设置令牌时允许 SDK 客户端连接', async () => {
    const handle = await startMcpHttp({
      env: cleanEnv(),
      host: '127.0.0.1',
      port: 0,
      cwd: tempDir(),
    });
    closers.push(() => handle.close());

    const client = await connect(handle.url);
    const listed = await client.listTools();
    expect(listed.tools.some((tool) => tool.name === 'ask')).toBe(true);
  });

  it('startMcpHttp 在设置令牌后要求本机请求也带 Bearer', async () => {
    const handle = await startMcpHttp({
      env: cleanEnv(),
      host: '127.0.0.1',
      port: 0,
      token: 'local-token',
      cwd: tempDir(),
    });
    closers.push(() => handle.close());

    const denied = await fetch(handle.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    expect(denied.status).toBe(401);

    const wrong = await fetch(handle.url, {
      method: 'POST',
      headers: {
        authorization: 'Bearer other-token',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: '{}',
    });
    expect(wrong.status).toBe(401);

    const client = await connect(handle.url, 'local-token');
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toContain('office_status');
  });

  it('startMcpHttp 绑定 0.0.0.0 时没有 Bearer 的请求返回 401', async () => {
    const handle = await startMcpHttp({
      env: { RELAY_SERVER_TOKEN: 'edge-token' },
      host: '0.0.0.0',
      port: 0,
      cwd: tempDir(),
    });
    closers.push(() => handle.close());

    const denied = await fetch(`http://127.0.0.1:${handle.port}/mcp`, { method: 'POST' });
    expect(denied.status).toBe(401);

    const client = await connect(`http://127.0.0.1:${handle.port}/mcp`, 'edge-token');
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toContain('list_agents');
  });

  it('无令牌时拒绝隧道转发的请求', async () => {
    const handle = await startMcpHttp({
      env: cleanEnv(),
      host: '127.0.0.1',
      port: 0,
      cwd: tempDir(),
    });
    closers.push(() => handle.close());
    const res = await fetch(handle.url, {
      method: 'POST',
      headers: { 'cf-connecting-ip': '1.2.3.4', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(401);
  });

  it('多个客户端可同时连接，/mcp/<agent> 只暴露固定模型的工具', async () => {
    const env = { ...cleanEnv(), RELAY_SERVER_TOKEN: 't' };
    const handle = await startMcpHttp({ env, host: '127.0.0.1', port: 0, cwd: REPO_ROOT });
    closers.push(() => handle.close());

    const a = await connect(handle.url, 't');
    const b = await connect(handle.url, 't');
    expect((await a.listTools()).tools.map((t) => t.name)).toContain('list_agents');
    expect((await b.listTools()).tools.map((t) => t.name)).toContain('ask');

    const pinned = await connect(`${handle.url}/codex`, 't');
    const tools = (await pinned.listTools()).tools;
    expect(tools.map((t) => t.name).sort()).toEqual(['ask', 'office_status']);
    const askTool = tools.find((t) => t.name === 'ask');
    expect(Object.keys(askTool?.inputSchema.properties ?? {})).not.toContain('provider');

    const missing = await fetch(`${handle.url}/nope`, {
      method: 'POST',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(missing.status).toBe(404);
  });
});

const REPO_ROOT = path.resolve(__dirname, '../../..');

function cleanEnv(): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH };
}

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'mcp-http-'));
  dirs.push(dir);
  return dir;
}

async function connect(url: string, token?: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    ...(token === undefined
      ? {}
      : { requestInit: { headers: { authorization: `Bearer ${token}` } } }),
  });
  const client = new Client({ name: 'relay-http-test', version: '0.0.0' });
  await client.connect(transport);
  closers.push(async () => {
    await client.close();
  });
  return client;
}
