import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

import { RelayError } from '@grokbot-ai-office/core';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8788;

export interface McpBind {
  host: string;
  port: number;
  token?: string;
}

export function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}

export function assertMcpBind(host: string, token: string | undefined): void {
  if (!isLoopbackHost(host) && (token === undefined || token.length === 0)) {
    throw new RelayError('CONFIG_INVALID', '绑定非本机地址时必须设置 RELAY_SERVER_TOKEN');
  }
}

export function resolveMcpBind(
  env: NodeJS.ProcessEnv = process.env,
  flags: { host?: string; port?: number } = {},
): McpBind {
  const hostFromEnv = env.RELAY_SERVER_HOST?.trim();
  const host = flags.host ?? (hostFromEnv && hostFromEnv.length > 0 ? hostFromEnv : DEFAULT_HOST);
  const port = flags.port ?? readMcpPort(env.RELAY_MCP_PORT);
  const token = normalizeToken(env.RELAY_SERVER_TOKEN);
  assertPort(port);
  return { host, port, ...(token === undefined ? {} : { token }) };
}

export function normalizeToken(raw: string | undefined): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const token = raw.trim();
  return token.length > 0 ? token : undefined;
}

export function bearerAuthorized(req: IncomingMessage, token: string | undefined): boolean {
  if (token === undefined || token.length === 0) {
    return true;
  }
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    return false;
  }
  return safeEqual(header.slice('Bearer '.length), token);
}

function readMcpPort(raw: string | undefined): number {
  if (raw === undefined || raw.trim().length === 0) {
    return DEFAULT_PORT;
  }
  if (!/^\d+$/.test(raw.trim())) {
    throw new RelayError('CONFIG_INVALID', 'RELAY_MCP_PORT 必须是数字');
  }
  return Number(raw);
}

function assertPort(port: number): void {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new RelayError('CONFIG_INVALID', '端口必须是 0 到 65535 的数字');
  }
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
