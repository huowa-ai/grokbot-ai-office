import { randomBytes, randomUUID } from 'node:crypto';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import * as path from 'node:path';

import { RelayError } from './errors.js';
import type { EventSink } from './ports.js';
import { redactSecrets } from './redact.js';
import { clampText, createEvent, parseInstance } from './schema.js';

export interface HandoffInput {
  from: string;
  to: string;
  filePath: string;
  note?: string;
  workspace: string;
  events: EventSink;
  now?: () => Date;
  createId?: () => string;
}

export interface HandoffResult {
  destPath: string;
  relativePath: string;
}

export async function handoff(input: HandoffInput): Promise<HandoffResult> {
  const from = parseInstance(input.from);
  const to = parseInstance(input.to);
  const toId = `${to.provider}@${to.host}`;
  const source = path.resolve(input.filePath);
  let sourceStat: Awaited<ReturnType<typeof stat>>;
  try {
    sourceStat = await stat(source);
  } catch (error) {
    const missing = isEnoent(error);
    throw new RelayError(
      'CONFIG_INVALID',
      missing ? `找不到交接文件：${path.basename(source)}` : '无法读取交接文件',
      { cause: error },
    );
  }
  if (!sourceStat.isFile()) {
    throw new RelayError('CONFIG_INVALID', '交接目标必须是文件');
  }

  const baseName = path.basename(source);
  if (!isSafeBaseName(baseName)) {
    throw new RelayError('CONFIG_INVALID', '文件名不合法');
  }

  const workspace = path.resolve(input.workspace);
  const outRoot = path.resolve(workspace, 'outbox');
  const destDir = path.resolve(outRoot, toId);
  assertInside(outRoot, destDir);
  await mkdir(destDir, { recursive: true });
  const destPath = await uniqueDestination(destDir, baseName);
  assertInside(outRoot, destPath);
  await copyFile(source, destPath);

  const relativePath = path.relative(workspace, destPath).split(path.sep).join('/');
  if (!relativePath.startsWith('outbox/')) {
    throw new RelayError('CONFIG_INVALID', '交接文件没有放进 outbox', { isOperational: false });
  }

  const note =
    input.note === undefined || input.note.trim().length === 0
      ? undefined
      : clampText(redactSecrets(input.note.trim()), 200);
  const now = input.now ?? (() => new Date());
  const createId = input.createId ?? randomUUID;

  await input.events.emit(
    createEvent({
      v: 1,
      id: createId(),
      ts: now().toISOString(),
      type: 'status',
      instance: input.from,
      provider: from.provider,
      host: from.host,
      taskId: `h_${createId()}`.slice(0, 200),
      payload: {
        state: 'handoff',
        source: 'lifecycle',
        from: input.from,
        to: toId,
        filePath: relativePath,
        ...(note === undefined ? {} : { note }),
      },
    }),
  );

  return { destPath, relativePath };
}

async function uniqueDestination(directory: string, baseName: string): Promise<string> {
  const first = path.join(directory, baseName);
  if (!(await exists(first))) {
    return first;
  }
  const extension = path.extname(baseName);
  const name = path.basename(baseName, extension);
  return path.join(directory, `${name}-${randomBytes(4).toString('hex')}${extension}`);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (isEnoent(error)) {
      return false;
    }
    throw new RelayError('CONFIG_INVALID', '无法检查交接目标', { cause: error });
  }
}

function assertInside(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new RelayError('CONFIG_INVALID', '交接路径超出 outbox');
  }
}

function isSafeBaseName(value: string): boolean {
  return (
    value.length > 0 &&
    value !== '.' &&
    value !== '..' &&
    !value.includes('/') &&
    !value.includes('\\')
  );
}

function isEnoent(error: unknown): boolean {
  return readCode(error) === 'ENOENT';
}

function readCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = error.code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}
