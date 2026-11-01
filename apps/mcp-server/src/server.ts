import type { Readable, Writable } from 'node:stream';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { type RelayMcpOptions, resolveMcpOptions } from './options.js';
import { registerPinnedTools, registerRelayTools } from './tools.js';

const INSTRUCTIONS = [
  '只调用注册表中的 AI。',
  '用 ask 提问，用 list_agents 查看本机可用实例，用 office_status 查看状态。',
  '不要执行 shell，不要拼接命令。',
].join('');

export function createRelayMcpServer(options: RelayMcpOptions = {}, agent?: string): McpServer {
  const resolved = resolveMcpOptions(options);
  if (agent !== undefined) {
    const server = new McpServer(
      { name: `ai-relay-${agent}`, version: '0.0.0' },
      { instructions: `你连接的是本机的 ${agent}。用 ask 提问，用 office_status 查看状态。` },
    );
    registerPinnedTools(server, resolved, agent);
    return server;
  }
  const server = new McpServer(
    { name: 'ai-relay', version: '0.0.0' },
    { instructions: INSTRUCTIONS },
  );
  registerRelayTools(server, resolved);
  return server;
}

export async function startMcpStdio(
  options: RelayMcpOptions = {},
  streams?: { stdin?: Readable; stdout?: Writable },
): Promise<void> {
  const resolved = resolveMcpOptions(options);
  const server = createRelayMcpServer(options);
  const transport = new StdioServerTransport(streams?.stdin, streams?.stdout);
  await server.connect(transport);
  resolved.log('MCP stdio 已启动');
  await new Promise<void>((resolve) => {
    const previous = transport.onclose;
    transport.onclose = () => {
      previous?.();
      resolve();
    };
  });
}
