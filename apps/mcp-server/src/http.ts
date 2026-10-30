import { randomUUID } from 'node:crypto';
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import type { Socket } from 'node:net';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { assertMcpBind, bearerAuthorized, normalizeToken, resolveMcpBind } from './bind.js';
import type { RelayMcpOptions } from './options.js';
import { resolveMcpOptions } from './options.js';
import { createRelayMcpServer } from './server.js';

export interface McpHttpOptions extends RelayMcpOptions {
  host?: string;
  port?: number;
  token?: string;
}

export interface McpHttpHandle {
  url: string;
  host: string;
  port: number;
  close(): Promise<void>;
}

export async function startMcpHttp(options: McpHttpOptions = {}): Promise<McpHttpHandle> {
  const env = options.env ?? process.env;
  const bind = resolveMcpBind(env, {
    ...(options.host === undefined ? {} : { host: options.host }),
    ...(options.port === undefined ? {} : { port: options.port }),
  });
  const token = options.token === undefined ? bind.token : normalizeToken(options.token);
  assertMcpBind(bind.host, token);
  const resolved = resolveMcpOptions(options);
  const mcp = createRelayMcpServer(options);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await mcp.connect(transport);

  const sockets = new Set<Socket>();
  const httpServer = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      if (res.headersSent) {
        return;
      }
      const name = error instanceof Error ? error.name : 'Error';
      resolved.log(`MCP 请求失败：${name}`);
      sendJson(res, 500, { ok: false, error: 'CONFIG_INVALID' });
    });
  });
  httpServer.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => {
      sockets.delete(socket);
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!bearerAuthorized(req, token)) {
      sendJson(res, 401, { ok: false, error: 'UNAUTHORIZED' });
      return;
    }
    const pathname = requestPath(req);
    if (pathname !== '/mcp') {
      sendJson(res, 404, { ok: false, error: 'NOT_FOUND' });
      return;
    }
    if (req.method !== 'POST' && req.method !== 'GET' && req.method !== 'DELETE') {
      sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    await transport.handleRequest(req, res);
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        reject(error);
      };
      httpServer.once('error', onError);
      httpServer.listen(bind.port, bind.host, () => {
        httpServer.off('error', onError);
        resolve();
      });
    });
  } catch (error) {
    await transport.close();
    await mcp.close();
    throw error;
  }

  const address = httpServer.address();
  const port = typeof address === 'object' && address !== null ? address.port : bind.port;
  const hostLabel = bind.host === '::1' ? '[::1]' : bind.host;

  return {
    url: `http://${hostLabel}:${port}/mcp`,
    host: bind.host,
    port,
    async close() {
      for (const socket of sockets) {
        socket.destroy();
      }
      await transport.close();
      await mcp.close();
      if (!httpServer.listening) {
        return;
      }
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

function requestPath(req: IncomingMessage): string {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const pathname = url.pathname.replace(/\/$/, '');
  return pathname.length > 0 ? pathname : '/';
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}
