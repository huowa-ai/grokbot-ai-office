import path from 'node:path';

import { createAdapter } from '@grokbot-ai-office/adapters';
import {
  type ProviderConfig,
  ProvidersConfigError,
  isAvailableOn,
  loadProvidersConfig,
  parseInstanceId,
  readRelayHost,
  resolveProvidersPath,
} from '@grokbot-ai-office/registry';

import { loadDotEnv } from './dotenv.js';

export interface SelfcheckIo {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

export interface SelfcheckOptions {
  name?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  io?: SelfcheckIo;
}

interface Row {
  name: string;
  auth: string;
  status: string;
  detail: string;
}

export async function runSelfcheck(options: SelfcheckOptions = {}): Promise<number> {
  const stderr = options.io?.stderr ?? writeStderr;
  const stdout = options.io?.stdout ?? writeStdout;
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;

  let host: string | undefined;
  try {
    host = readRelayHost(env);
  } catch (error) {
    const detail = error instanceof ProvidersConfigError ? error.message : 'RELAY_HOST 无效';
    stderr(`CONFIG_INVALID ${detail}`);
    return 1;
  }

  let selected = options.name;
  let requestedHost: string | undefined;
  if (selected?.includes('@')) {
    try {
      const parsed = parseInstanceId(selected);
      selected = parsed.provider;
      requestedHost = parsed.host;
    } catch (error) {
      const detail = error instanceof ProvidersConfigError ? error.message : '实例标识无效';
      stderr(`CONFIG_INVALID ${detail}`);
      return 1;
    }
  }

  if (requestedHost !== undefined && requestedHost.length > 0 && requestedHost !== (host ?? '')) {
    const message =
      host === undefined
        ? `实例标识指定了主机 ${requestedHost}，但未设置 RELAY_HOST`
        : `实例标识的主机 ${requestedHost} 与当前 RELAY_HOST ${host} 不一致`;
    stderr(`CONFIG_INVALID ${message}`);
    return 1;
  }

  let providers: Record<string, ProviderConfig>;
  try {
    providers = loadProvidersConfig(resolveProvidersPath(cwd)).providers;
  } catch (error) {
    const detail = error instanceof ProvidersConfigError ? error.message : '无法读取配置';
    stderr(`CONFIG_INVALID ${detail}`);
    return 1;
  }

  if (selected !== undefined && !Object.hasOwn(providers, selected)) {
    stderr(`PROVIDER_NOT_FOUND 未找到提供者：${selected}`);
    return 1;
  }

  const names = selected === undefined ? Object.keys(providers) : [selected];
  const rows: Row[] = [];
  let failures = 0;
  let skipped = 0;

  for (const name of names) {
    const provider = providers[name];
    if (!provider) {
      continue;
    }
    if (!isAvailableOn(provider, host)) {
      const detail =
        host === undefined
          ? '未设置 RELAY_HOST，且提供者限定了主机'
          : `当前主机 ${host} 不在 hosts 中`;
      if (selected !== undefined) {
        failures += 1;
        rows.push({ name, auth: provider.auth, status: '失败', detail });
      } else {
        skipped += 1;
        rows.push({ name, auth: provider.auth, status: '跳过', detail });
      }
      continue;
    }

    const check = await createAdapter(provider, name, {
      env,
      fetchImpl: options.fetchImpl,
    }).selfcheck();
    if (!check.ok) {
      failures += 1;
    }
    rows.push({
      name,
      auth: provider.auth,
      status: check.ok ? '通过' : '失败',
      detail: check.detail,
    });
  }

  const passed = rows.filter((row) => row.status === '通过').length;
  stdout(formatTable(rows));
  stdout(`通过 ${passed}，失败 ${failures}，跳过 ${skipped}`);
  return failures > 0 ? 1 : 0;
}

export async function main(argv: readonly string[]): Promise<number> {
  if (argv.length > 1) {
    console.error('用法：pnpm selfcheck [名字]');
    return 1;
  }
  const env = { ...process.env };
  loadDotEnv(path.join(process.cwd(), '.env'), env);
  return runSelfcheck({ name: argv[0], env });
}

function formatTable(rows: readonly Row[]): string {
  const header = ['名字', '接入方式', '状态', '说明'];
  const body = rows.map((row) => [row.name, row.auth, row.status, row.detail]);
  const widths = header.map((label, index) =>
    Math.max(displayWidth(label), ...body.map((columns) => displayWidth(columns[index] ?? ''))),
  );
  const lines = [header, ...body].map((columns) =>
    columns.map((column, index) => pad(column, widths[index] ?? 0)).join('  '),
  );
  return lines.join('\n');
}

function pad(text: string, width: number): string {
  const gap = width - displayWidth(text);
  return gap > 0 ? `${text}${' '.repeat(gap)}` : text;
}

function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    width += char.charCodeAt(0) > 255 ? 2 : 1;
  }
  return width;
}

function writeStdout(text: string): void {
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
}

function writeStderr(text: string): void {
  console.error(text);
}
