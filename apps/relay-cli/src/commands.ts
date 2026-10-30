import path from 'node:path';

import { resolveWorkspace } from '@grokbot-ai-office/adapters';
import {
  RelayError,
  handoff,
  hookRequestFromUnknown,
  listApprovals,
  planHook,
  readStateChunkLimit,
  requestApproval,
  resolveApproval,
} from '@grokbot-ai-office/core';
import { resolveServerBind, startEventServer } from '@grokbot-ai-office/event-server';
import { createJsonlEventSink, readEvents, resolveEventsPath } from '@grokbot-ai-office/events';
import { formatInstanceId, readRelayHost } from '@grokbot-ai-office/registry';

import type { RunIo } from './main.js';

export async function runServe(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  io: RunIo,
): Promise<number> {
  const stderr = io.stderr ?? writeStderr;
  const stdout = io.stdout ?? writeStdout;
  try {
    const flags = parseServeArgs(argv);
    const bind = resolveServerBind(env, flags);
    const handle = await startEventServer({
      eventsPath: resolveEventsPath(env),
      host: bind.host,
      port: bind.port,
      ...(bind.token === undefined ? {} : { token: bind.token }),
      chunkLimit: readStateChunkLimit(env),
    });
    stdout(`事件服务已监听 ${handle.url}`);
    await waitForStop(io.signal);
    await handle.close();
    return 0;
  } catch (error) {
    return report(error, stderr);
  }
}

export async function runHandoff(
  argv: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  io: RunIo,
): Promise<number> {
  const stderr = io.stderr ?? writeStderr;
  const stdout = io.stdout ?? writeStdout;
  const [from, to, file, ...notes] = argv;
  if (!from || !to || !file) {
    stderr('用法：ai-relay handoff <from> <to> <文件> [备注]');
    return 1;
  }
  try {
    const result = await handoff({
      from,
      to,
      filePath: path.resolve(cwd, file),
      ...(notes.length === 0 ? {} : { note: notes.join(' ') }),
      workspace: resolveWorkspace(env),
      events: createJsonlEventSink(resolveEventsPath(env)),
    });
    stdout(result.relativePath);
    return 0;
  } catch (error) {
    return report(error, stderr);
  }
}

export async function runApproval(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  io: RunIo,
): Promise<number> {
  const stderr = io.stderr ?? writeStderr;
  const stdout = io.stdout ?? writeStdout;
  const [action, ...rest] = argv;
  const eventsPath = resolveEventsPath(env);
  const sink = createJsonlEventSink(eventsPath);
  try {
    if (action === 'request') {
      const [instance, ...summaryParts] = rest;
      if (!instance || summaryParts.length === 0) {
        stderr('用法：ai-relay approval request <实例> <摘要>');
        return 1;
      }
      const result = await requestApproval({
        instance,
        summary: summaryParts.join(' '),
        events: sink,
      });
      stdout(result.approvalId);
      return 0;
    }
    if (action === 'resolve') {
      const [approvalId, decision] = rest;
      if (!approvalId || !decision) {
        stderr('用法：ai-relay approval resolve <id> <true|false>');
        return 1;
      }
      const approved = parseApproved(decision);
      const records = listApprovals(await readEvents(eventsPath));
      const found = records.find((record) => record.id === approvalId);
      if (!found) {
        throw new RelayError('CONFIG_INVALID', '找不到批准事项');
      }
      if (found.status !== 'pending') {
        throw new RelayError('CONFIG_INVALID', '该事项已处理');
      }
      await resolveApproval({
        approvalId,
        approved,
        instance: found.instance,
        events: sink,
      });
      stdout(approved ? 'approved' : 'denied');
      return 0;
    }
    if (action === 'list') {
      const records = listApprovals(await readEvents(eventsPath));
      if (records.length === 0) {
        stdout('没有批准事项');
        return 0;
      }
      for (const record of records) {
        stdout(`${record.status} ${record.id} ${record.instance} ${record.summary}`);
      }
      return 0;
    }
    stderr('用法：ai-relay approval request|resolve|list');
    return 1;
  } catch (error) {
    return report(error, stderr);
  }
}

export async function runHook(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  io: RunIo,
): Promise<number> {
  const stderr = io.stderr ?? writeStderr;
  try {
    const fromStdin = await readHookStdin(io);
    const fromArgs = parseHookArgs(argv);
    const merged = {
      ...(fromStdin ?? {}),
      ...stripEmpty(fromArgs),
    };
    if (merged.instance === undefined) {
      merged.instance = instanceFromEnv(env, fromArgs.provider);
    }
    const plan = planHook(merged);
    if (plan.action === 'ignore') {
      return 0;
    }
    await createJsonlEventSink(resolveEventsPath(env)).emit(plan.event);
    return 0;
  } catch (error) {
    return report(error, stderr);
  }
}

export function usageText(): string {
  return [
    '用法：ai-relay <名字> <提示>。省略提示时从标准输入读取。',
    'ai-relay serve [--host 127.0.0.1] [--port 8787]',
    'ai-relay handoff <from> <to> <文件> [备注]',
    'ai-relay approval request <实例> <摘要>',
    'ai-relay approval resolve <id> <true|false>',
    'ai-relay approval list',
    'ai-relay hook <事件> --instance <provider@host> [--summary 文本]',
  ].join('\n');
}

function parseServeArgs(argv: readonly string[]): { host?: string; port?: number } {
  let host: string | undefined;
  let port: number | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--host') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new RelayError('CONFIG_INVALID', '缺少 --host 的值');
      }
      host = value;
      index += 1;
      continue;
    }
    if (arg === '--port') {
      const value = argv[index + 1];
      if (value === undefined || !/^\d+$/.test(value)) {
        throw new RelayError('CONFIG_INVALID', '端口必须是 0 到 65535 的数字');
      }
      const parsed = Number(value);
      if (parsed > 65535) {
        throw new RelayError('CONFIG_INVALID', '端口必须是 0 到 65535 的数字');
      }
      port = parsed;
      index += 1;
      continue;
    }
    throw new RelayError('CONFIG_INVALID', `无法识别的参数：${arg ?? ''}`);
  }
  return {
    ...(host === undefined ? {} : { host }),
    ...(port === undefined ? {} : { port }),
  };
}

function parseHookArgs(argv: readonly string[]): {
  event?: string;
  instance?: string;
  summary?: string;
  taskId?: string;
  code?: string;
  reason?: string;
  provider?: string;
} {
  let event: string | undefined;
  const flags: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      continue;
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new RelayError('CONFIG_INVALID', `缺少 --${key} 的值`);
      }
      flags[key] = value;
      index += 1;
      continue;
    }
    if (event === undefined) {
      event = arg;
      continue;
    }
    throw new RelayError('CONFIG_INVALID', `无法识别的参数：${arg}`);
  }
  return {
    ...(event === undefined ? {} : { event }),
    ...(flags.instance === undefined ? {} : { instance: flags.instance }),
    ...(flags.summary === undefined ? {} : { summary: flags.summary }),
    ...(flags.task === undefined ? {} : { taskId: flags.task }),
    ...(flags.code === undefined ? {} : { code: flags.code }),
    ...(flags.reason === undefined ? {} : { reason: flags.reason }),
    ...(flags.provider === undefined ? {} : { provider: flags.provider }),
  };
}

async function readHookStdin(
  io: RunIo,
): Promise<ReturnType<typeof hookRequestFromUnknown> | undefined> {
  if (!io.stdin || io.isTTY === true) {
    return undefined;
  }
  const text = await readStream(io.stdin);
  if (text.trim().length === 0) {
    return undefined;
  }
  try {
    return hookRequestFromUnknown(JSON.parse(text) as unknown);
  } catch (error) {
    if (error instanceof RelayError) {
      throw error;
    }
    throw new RelayError('CONFIG_INVALID', '钩子标准输入不是 JSON 对象', { cause: error });
  }
}

function instanceFromEnv(env: NodeJS.ProcessEnv, provider: string | undefined): string {
  const configured = env.RELAY_HOOK_INSTANCE;
  if (typeof configured === 'string' && configured.trim().length > 0) {
    return configured.trim();
  }
  if (provider === undefined) {
    throw new RelayError('CONFIG_INVALID', '钩子需要 --instance，或设置 RELAY_HOOK_INSTANCE');
  }
  let host: string | undefined;
  try {
    host = readRelayHost(env);
  } catch (error) {
    throw new RelayError('CONFIG_INVALID', 'RELAY_HOST 无效', { cause: error });
  }
  if (host === undefined) {
    throw new RelayError(
      'CONFIG_INVALID',
      '钩子需要 --instance，或同时提供 --provider 与 RELAY_HOST',
    );
  }
  try {
    return formatInstanceId(provider, host);
  } catch (error) {
    throw new RelayError('CONFIG_INVALID', '实例标识无效', { cause: error });
  }
}

function stripEmpty<T extends object>(value: T): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, item] of Object.entries(value) as [keyof T, T[keyof T]][]) {
    if (item !== undefined) {
      result[key] = item;
    }
  }
  return result;
}

function parseApproved(value: string): boolean {
  if (value === 'true' || value === 'yes' || value === 'approved' || value === '1') {
    return true;
  }
  if (value === 'false' || value === 'no' || value === 'denied' || value === '0') {
    return false;
  }
  throw new RelayError('CONFIG_INVALID', '批准结果只能是 true 或 false');
}

async function waitForStop(signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) {
    return;
  }
  await new Promise<void>((resolve) => {
    const stop = (): void => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      resolve();
    };
    signal?.addEventListener('abort', stop, { once: true });
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  });
}

async function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk));
    } else if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
    } else {
      chunks.push(Buffer.from(chunk));
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}

function report(error: unknown, stderr: (text: string) => void): number {
  if (error instanceof RelayError) {
    stderr(`${error.code} ${error.message}`);
    return 1;
  }
  throw error;
}

function writeStdout(text: string): void {
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
}

function writeStderr(text: string): void {
  console.error(text);
}
