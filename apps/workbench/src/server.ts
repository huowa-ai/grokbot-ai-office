import { existsSync, readFileSync } from 'node:fs';
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import { createRequire } from 'node:module';
import type { Socket } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { WebSocketServer } from 'ws';

import { agentStatuses } from './agents.js';
import { renderMarkdown } from './markdown.js';
import { listOutbox, readOutboxFile, taskExitCode } from './outbox.js';
import {
  type Exec,
  capturePane,
  defaultExec,
  killSession,
  listSessions,
  parseSessionName,
  sessionState,
} from './sessions.js';

export interface WorkbenchOptions {
  port?: number;
  publicDir?: string;
  outboxRoot: string;
  binFor: (agent: string) => string;
  exec?: Exec;
  pathEnv?: string;
  /** 测试可关闭 node-pty。 */
  disablePty?: boolean;
}

export interface WorkbenchHandle {
  url: string;
  port: number;
  ptyAvailable: boolean;
  close(): Promise<void>;
}

interface PtyLike {
  onData(cb: (data: string) => void): void;
  onExit(cb: () => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}
type PtySpawn = (file: string, args: string[], opts: Record<string, unknown>) => PtyLike;

function loadPty(): PtySpawn | undefined {
  try {
    const require = createRequire(import.meta.url);
    const mod = require('node-pty') as { spawn?: PtySpawn };
    return mod.spawn;
  } catch {
    return undefined;
  }
}

export function defaultPublicDir(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

export async function startWorkbench(options: WorkbenchOptions): Promise<WorkbenchHandle> {
  const exec = options.exec ?? defaultExec;
  const publicDir = options.publicDir ?? defaultPublicDir();
  const spawnPty = options.disablePty ? undefined : loadPty();
  let origin = '';

  const server = createServer((req, res) => {
    try {
      handle(req, res);
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : '出错了' });
    }
  });

  function sameOrigin(req: IncomingMessage): boolean {
    const o = req.headers.origin;
    return o === undefined ? req.headers['x-workbench'] === '1' : o === origin;
  }

  const sessionsWithState = () =>
    listSessions(exec).map((s) => ({
      ...s,
      state: sessionState(s.status, taskExitCode(options.outboxRoot, s.task)),
    }));

  function handle(req: IncomingMessage, res: ServerResponse): boolean {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const p = url.pathname;
    if (req.method === 'GET' && p === '/api/sessions') {
      return json(res, 200, { sessions: sessionsWithState(), pty: spawnPty !== undefined });
    }
    if (req.method === 'GET' && p === '/api/status') {
      return json(res, 200, {
        agents: agentStatuses(sessionsWithState(), options.binFor, options.pathEnv),
      });
    }
    if (req.method === 'GET' && p === '/api/outbox') {
      const entries = listOutbox(options.outboxRoot).map((e) => ({
        ...e,
        readmeHtml: e.readme === null ? null : renderMarkdown(e.readme),
      }));
      return json(res, 200, { root: options.outboxRoot, entries });
    }
    if (req.method === 'GET' && p === '/api/outbox/file') {
      const text = readOutboxFile(
        options.outboxRoot,
        url.searchParams.get('folder') ?? '',
        url.searchParams.get('file') ?? '',
      );
      return json(res, 200, { text });
    }
    const cap = /^\/api\/sessions\/([^/]+)\/capture$/.exec(p);
    if (req.method === 'GET' && cap) {
      const name = decodeURIComponent(cap[1] as string);
      if (!parseSessionName(name)) return json(res, 404, { error: 'NOT_FOUND' });
      return json(res, 200, { text: capturePane(name, exec) });
    }
    const kill = /^\/api\/sessions\/([^/]+)\/kill$/.exec(p);
    if (req.method === 'POST' && kill) {
      if (!sameOrigin(req)) return json(res, 403, { error: 'FORBIDDEN' });
      killSession(decodeURIComponent(kill[1] as string), exec);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET') {
      const rel = p === '/' ? 'index.html' : p.slice(1);
      const file = path.resolve(publicDir, rel);
      if (file.startsWith(path.resolve(publicDir) + path.sep) && existsSync(file)) {
        res.writeHead(200, {
          'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
        });
        res.end(readFileSync(file));
        return true;
      }
    }
    return json(res, 404, { error: 'NOT_FOUND' });
  }

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const m = /^\/term\/([^/?]+)/.exec(req.url ?? '');
    const name = m ? decodeURIComponent(m[1] as string) : '';
    if (!spawnPty || !parseSessionName(name) || req.headers.origin !== origin) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const term = spawnPty('tmux', ['attach-session', '-t', `=${name}`], {
        name: 'xterm-256color',
        cols: 100,
        rows: 30,
        env: { ...process.env, TERM: 'xterm-256color' },
      });
      term.onData((d) => ws.readyState === ws.OPEN && ws.send(d));
      term.onExit(() => ws.close());
      ws.on('message', (raw) => {
        const msg = raw.toString();
        if (msg.startsWith('\u0001resize:')) {
          const [cols, rows] = msg.slice(8).split('x').map(Number);
          if (cols && rows) term.resize(cols, rows);
          return;
        }
        term.write(msg);
      });
      ws.on('close', () => term.kill()); // 只断开这个客户端，tmux 会话不受影响
    });
  });

  const sockets = new Set<Socket>();
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 8790, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  origin = `http://127.0.0.1:${port}`;
  return {
    url: `${origin}/`,
    port,
    ptyAvailable: spawnPty !== undefined,
    async close() {
      for (const client of wss.clients) client.terminate();
      for (const s of sockets) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

function json(res: ServerResponse, status: number, body: unknown): boolean {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(payload);
  return true;
}
