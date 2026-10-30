import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RelayError } from '@grokbot-ai-office/core';
import { startOfficeServer } from '@grokbot-ai-office/office/server';
import {
  ProvidersConfigError,
  extractOfficeAppearances,
  loadProvidersConfig,
  resolveProvidersPath,
} from '@grokbot-ai-office/registry';

import type { RunIo } from './main.js';

const DEFAULT_PORT = 8789;

export async function runOffice(
  argv: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  io: RunIo,
): Promise<number> {
  const stderr = io.stderr ?? ((text: string) => console.error(text));
  const stdout = io.stdout ?? ((text: string) => process.stdout.write(`${text}\n`));
  try {
    const flags = parseOfficeArgs(argv);
    const root = resolveOfficeRoot(cwd, env);
    const providerStyles = readProviderStyles(cwd, stderr);
    const port = flags.port ?? readOfficePort(env.RELAY_OFFICE_PORT);
    const handle = await startOfficeServer({
      root,
      host: '127.0.0.1',
      port,
      providerStyles,
    });
    const suffix = flags.demo ? '/?demo=1' : '/';
    stdout(`办公室已打开 ${handle.url}${suffix}`);
    await waitForStop(io.signal);
    await handle.close();
    return 0;
  } catch (error) {
    if (error instanceof RelayError) {
      stderr(`${error.code} ${error.message}`);
      return 1;
    }
    if (error instanceof Error && error.message.includes('本机')) {
      stderr(`CONFIG_INVALID ${error.message}`);
      return 1;
    }
    throw error;
  }
}

export function resolveOfficeRoot(cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  const override = env.RELAY_OFFICE_DIST?.trim();
  if (override && override.length > 0) {
    if (!existsSync(path.join(override, 'index.html'))) {
      throw new RelayError('CONFIG_INVALID', 'RELAY_OFFICE_DIST 里没有办公室页面');
    }
    return override;
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(cwd, 'apps/office/dist'),
    path.resolve(here, '../../office/dist'),
    path.resolve(here, '../../../office/dist'),
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'index.html'))) {
      return candidate;
    }
  }
  throw new RelayError(
    'CONFIG_INVALID',
    '找不到办公室页面。请先运行 pnpm --filter @grokbot-ai-office/office build',
  );
}

function readProviderStyles(
  cwd: string,
  stderr: (text: string) => void,
): { providers: ReturnType<typeof extractOfficeAppearances>; instances: Record<string, never> } {
  const configPath = resolveProvidersPath(cwd);
  if (!existsSync(configPath)) {
    return { providers: {}, instances: {} };
  }
  try {
    return {
      providers: extractOfficeAppearances(loadProvidersConfig(configPath)),
      instances: {},
    };
  } catch (error) {
    if (error instanceof ProvidersConfigError) {
      stderr('CONFIG_INVALID 注册表里的办公室样式无法读取，已使用默认形象');
      return { providers: {}, instances: {} };
    }
    throw error;
  }
}

function parseOfficeArgs(argv: readonly string[]): { port?: number; demo: boolean } {
  let port: number | undefined;
  let demo = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--demo') {
      demo = true;
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
  return { demo, ...(port === undefined ? {} : { port }) };
}

function readOfficePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim().length === 0) {
    return DEFAULT_PORT;
  }
  if (!/^\d+$/.test(raw.trim())) {
    throw new RelayError('CONFIG_INVALID', 'RELAY_OFFICE_PORT 必须是数字');
  }
  const port = Number(raw);
  if (port > 65535) {
    throw new RelayError('CONFIG_INVALID', 'RELAY_OFFICE_PORT 超出范围');
  }
  return port;
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
