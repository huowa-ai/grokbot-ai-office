import { timingSafeEqual } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';

import {
  RelayError,
  type RelayEvent,
  createOfficeState,
  hookRequestFromUnknown,
  planHook,
  readStateChunkLimit,
} from '@grokbot-ai-office/core';
import { createJsonlEventSink, relayEventSchema } from '@grokbot-ai-office/events';
import { WebSocket, WebSocketServer } from 'ws';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8787;
const BODY_LIMIT = 65_536;

export interface EventServerOptions {
  eventsPath: string;
  host?: string;
  port?: number;
  token?: string;
  chunkLimit?: number;
  pollMs?: number;
  log?: (message: string) => void;
}

export interface EventServerHandle {
  url: string;
  host: string;
  port: number;
  close(): Promise<void>;
}

export interface ServerBind {
  host: string;
  port: number;
  token?: string;
}

export function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}

export function assertServerBind(host: string, token: string | undefined): void {
  if (!isLoopbackHost(host) && (token === undefined || token.length === 0)) {
    throw new RelayError('CONFIG_INVALID', '绑定非本机地址时必须设置 RELAY_SERVER_TOKEN');
  }
}

export function resolveServerBind(
  env: NodeJS.ProcessEnv = process.env,
  flags: { host?: string; port?: number } = {},
): ServerBind {
  const hostFromEnv = env.RELAY_SERVER_HOST?.trim();
  const host = flags.host ?? (hostFromEnv && hostFromEnv.length > 0 ? hostFromEnv : DEFAULT_HOST);
  const port = flags.port ?? readPort(env.RELAY_SERVER_PORT);
  const tokenRaw = env.RELAY_SERVER_TOKEN;
  const token =
    typeof tokenRaw === 'string' && tokenRaw.trim().length > 0 ? tokenRaw.trim() : undefined;
  return { host, port, ...(token === undefined ? {} : { token }) };
}

export async function startEventServer(options: EventServerOptions): Promise<EventServerHandle> {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const token = options.token;
  assertServerBind(host, token);
  const log = options.log ?? ((message: string) => console.error(message));
  const chunkLimit = options.chunkLimit ?? readStateChunkLimit();
  let office = createOfficeState({ chunkLimit });
  const sink = createJsonlEventSink(options.eventsPath);
  let offset = 0;
  let remainder = '';
  let reading = Promise.resolve();

  const clients = new Set<WebSocket>();

  const applyFresh = (events: RelayEvent[]): void => {
    for (const event of events) {
      office.apply(event);
    }
    if (events.length === 0) {
      return;
    }
    for (const event of events) {
      const data = JSON.stringify(event);
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data);
        }
      }
    }
  };

  const poll = async (): Promise<void> => {
    const run = reading.then(() => readNewEvents());
    reading = run.then(
      () => undefined,
      () => undefined,
    );
    await run;
  };

  const readNewEvents = async (): Promise<void> => {
    let size: number;
    try {
      size = (await stat(options.eventsPath)).size;
    } catch (error) {
      if (readCode(error) === 'ENOENT') {
        return;
      }
      throw error;
    }
    if (size < offset) {
      offset = 0;
      remainder = '';
      office = createOfficeState({ chunkLimit });
    }
    if (size === offset) {
      return;
    }
    const length = size - offset;
    const buffer = Buffer.alloc(length);
    const handle = await open(options.eventsPath, 'r');
    try {
      await handle.read(buffer, 0, length, offset);
    } finally {
      await handle.close();
    }
    offset = size;
    const text = remainder + buffer.toString('utf8');
    const lines = text.split('\n');
    remainder = lines.pop() ?? '';
    const fresh: RelayEvent[] = [];
    for (const line of lines) {
      const event = parseEventLine(line);
      if (event) {
        fresh.push(event);
      }
    }
    applyFresh(fresh);
  };

  const server = createServer((req, res) => {
    void handleRequest(req, res).catch((error: unknown) => {
      if (res.headersSent) {
        return;
      }
      if (error instanceof RelayError) {
        log(`事件服务请求失败：${error.code}`);
        sendJson(res, 400, { ok: false, error: error.code });
        return;
      }
      log('事件服务请求失败');
      sendJson(res, 500, { ok: false, error: 'CONFIG_INVALID' });
    });
  });

  const sockets = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = requestUrl(req);
    if (url.pathname !== '/events') {
      socket.destroy();
      return;
    }
    if (!authorized(req, token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(req, socket, head, (ws) => {
      clients.add(ws);
      ws.on('close', () => {
        clients.delete(ws);
      });
      ws.on('error', (error: Error) => {
        log(`事件服务连接失败：${error.message}`);
      });
    });
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    applyCors(res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = requestUrl(req);
    if (!authorized(req, token)) {
      sendJson(res, 401, { ok: false, error: 'UNAUTHORIZED' });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/state') {
      await poll();
      const snapshot = office.snapshot();
      const instance = url.searchParams.get('instance');
      const instances =
        instance === null
          ? snapshot.instances
          : snapshot.instances.filter((item) => item.instance === instance);
      sendJson(res, 200, {
        v: 1,
        generatedAt: new Date().toISOString(),
        instances,
      });
      return;
    }
    if (url.pathname === '/hook') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
        return;
      }
      const body = await readBody(req);
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch (error) {
        throw new RelayError('CONFIG_INVALID', '钩子请求不是 JSON', { cause: error });
      }
      const plan = planHook(hookRequestFromUnknown(parsed));
      if (plan.action === 'ignore') {
        sendJson(res, 200, { ok: true, ignored: true });
        return;
      }
      await sink.emit(plan.event);
      await poll();
      const status = plan.event.type === 'status' ? plan.event.payload.state : plan.event.type;
      sendJson(res, 200, { ok: true, id: plan.event.id, status });
      return;
    }
    sendJson(res, 404, { ok: false, error: 'NOT_FOUND' });
  }

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      reject(error);
    };
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });

  try {
    await poll();
  } catch (error) {
    const message = error instanceof Error ? error.message : '无法读取事件';
    log(`事件服务读取失败：${message}`);
  }

  const timer = setInterval(() => {
    void poll().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : '无法读取事件';
      log(`事件服务读取失败：${message}`);
    });
  }, options.pollMs ?? 200);
  timer.unref();

  const address = server.address();
  const boundPort = typeof address === 'object' && address !== null ? address.port : port;

  return {
    url: `http://${host === '::1' ? '[::1]' : host}:${boundPort}`,
    host,
    port: boundPort,
    async close() {
      clearInterval(timer);
      for (const client of clients) {
        client.close();
      }
      await new Promise<void>((resolve, reject) => {
        sockets.close();
        server.close((error) => {
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

function applyCors(res: ServerResponse): void {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'authorization, content-type');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-max-age', '600');
}

function authorized(req: IncomingMessage, token: string | undefined): boolean {
  if (token === undefined || token.length === 0) {
    return true;
  }
  const header = req.headers.authorization;
  let provided = '';
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    provided = header.slice('Bearer '.length);
  } else {
    provided = requestUrl(req).searchParams.get('token') ?? '';
  }
  return safeEqual(provided, token);
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

function requestUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? '/', 'http://127.0.0.1');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > BODY_LIMIT) {
      throw new RelayError('CONFIG_INVALID', '请求体过大');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseEventLine(line: string): RelayEvent | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    const result = relayEventSchema.safeParse(parsed);
    return result.success ? result.data : undefined;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
}

function readPort(raw: string | undefined): number {
  if (raw === undefined || raw.trim().length === 0) {
    return DEFAULT_PORT;
  }
  if (!/^\d+$/.test(raw.trim())) {
    throw new RelayError('CONFIG_INVALID', 'RELAY_SERVER_PORT 必须是数字');
  }
  const port = Number(raw);
  if (port > 65535) {
    throw new RelayError('CONFIG_INVALID', 'RELAY_SERVER_PORT 超出范围');
  }
  return port;
}

function readCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = error.code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}
