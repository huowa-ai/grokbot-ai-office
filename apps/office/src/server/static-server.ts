import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { type ServerResponse, createServer } from 'node:http';
import path from 'node:path';

import { emptyCatalog } from '../styles/agents.js';
import { mergeCatalogs, parseStyleCatalog } from '../styles/catalog.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8789;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

export interface OfficeServerOptions {
  root: string;
  host?: string;
  port?: number;
  providerStyles?: unknown;
  log?: (message: string) => void;
}

export interface OfficeServerHandle {
  url: string;
  host: string;
  port: number;
  close(): Promise<void>;
}

export function assertLoopback(host: string): void {
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    throw new Error('办公室页面只监听本机地址');
  }
}

export async function startOfficeServer(options: OfficeServerOptions): Promise<OfficeServerHandle> {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  assertLoopback(host);
  const root = path.resolve(options.root);
  const log = options.log ?? ((message: string) => console.error(message));
  const providerStyles = parseStyleCatalog(options.providerStyles ?? {});

  const server = createServer((req, res) => {
    void handle(req.method ?? 'GET', req.url ?? '/', res).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : '无法读取办公室页面';
      log(message);
      if (!res.headersSent) {
        sendText(res, 500, '无法读取办公室页面');
      }
    });
  });

  async function handle(method: string, rawUrl: string, res: ServerResponse): Promise<void> {
    if (method !== 'GET' && method !== 'HEAD') {
      sendText(res, 405, '方法不允许');
      return;
    }
    const pathname = new URL(rawUrl, 'http://127.0.0.1').pathname;
    if (pathname === '/office-styles.json') {
      const fileStyles = await readStyleFile(root, log);
      const body = JSON.stringify(mergeCatalogs(fileStyles, providerStyles));
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(body),
      });
      res.end(method === 'HEAD' ? undefined : body);
      return;
    }
    const filePath = resolveFile(root, pathname);
    if (!filePath) {
      sendText(res, 400, '路径不合法');
      return;
    }
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      info = await stat(filePath);
    } catch (error) {
      if (!isEnoent(error)) {
        throw error;
      }
      if (path.extname(pathname).length > 0) {
        sendText(res, 404, '找不到文件');
        return;
      }
      await sendFile(res, path.join(root, 'index.html'), method);
      return;
    }
    if (info.isDirectory()) {
      await sendFile(res, path.join(filePath, 'index.html'), method);
      return;
    }
    await sendFile(res, filePath, method);
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

  const address = server.address();
  const bound = typeof address === 'object' && address !== null ? address.port : port;
  return {
    url: `http://${host === '::1' ? '[::1]' : host}:${bound}`,
    host,
    port: bound,
    close() {
      return new Promise((resolve, reject) => {
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

async function readStyleFile(
  root: string,
  log: (message: string) => void,
): Promise<ReturnType<typeof parseStyleCatalog>> {
  try {
    const text = await readFile(path.join(root, 'office-styles.json'), 'utf8');
    return parseStyleCatalog(JSON.parse(text) as unknown);
  } catch (error) {
    if (isEnoent(error)) {
      return emptyCatalog();
    }
    if (error instanceof SyntaxError) {
      log('办公室样式文件无法解析，已忽略');
      return emptyCatalog();
    }
    throw error;
  }
}

function resolveFile(root: string, pathname: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch (error) {
    if (error instanceof URIError) {
      return undefined;
    }
    throw error;
  }
  if (decoded.includes('\0')) {
    return undefined;
  }
  const relative = decoded.replace(/^\/+/, '');
  const full = path.resolve(root, relative);
  const base = path.resolve(root);
  if (full !== base && !full.startsWith(`${base}${path.sep}`)) {
    return undefined;
  }
  return full;
}

async function sendFile(res: ServerResponse, filePath: string, method: string): Promise<void> {
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(filePath);
  } catch (error) {
    if (isEnoent(error)) {
      sendText(res, 404, '找不到文件');
      return;
    }
    throw error;
  }
  const type = TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, {
    'content-type': type,
    'content-length': info.size,
    'cache-control': path.extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=3600',
  });
  if (method === 'HEAD') {
    res.end();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('end', () => resolve());
    stream.pipe(res);
  });
}

function sendText(res: ServerResponse, status: number, message: string): void {
  const body = message;
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
