import { createAdapter } from '@grokbot-ai-office/adapters';
import { RelayError, noopEventSink, relay } from '@grokbot-ai-office/core';
import {
  ProvidersConfigError,
  type ProvidersFile,
  isAvailableOn,
  loadProvidersConfig,
  parseInstanceId,
  readRelayHost,
  resolveProvidersPath,
} from '@grokbot-ai-office/registry';

export interface RunIo {
  stdin?: NodeJS.ReadableStream;
  isTTY?: boolean;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

export async function run(
  argv: readonly string[],
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
  io: RunIo = {},
): Promise<number> {
  const stderr = io.stderr ?? writeStderr;
  const stdout = io.stdout ?? writeStdout;
  const [rawName, ...promptParts] = argv;
  if (!rawName) {
    stderr('用法：ai-relay <名字> <提示>。省略提示时从标准输入读取。');
    return 1;
  }

  const prompt = await resolvePrompt(promptParts, io);
  if (prompt === undefined) {
    stderr('用法：ai-relay <名字> <提示>。省略提示时从标准输入读取。');
    return 1;
  }

  let host: string | undefined;
  try {
    host = readRelayHost(env);
  } catch (error) {
    const detail = error instanceof ProvidersConfigError ? error.message : 'RELAY_HOST 无效';
    stderr(`CONFIG_INVALID ${detail}`);
    return 1;
  }

  let providerName = rawName;
  let requestedHost: string | undefined;
  if (rawName.includes('@')) {
    try {
      const parsed = parseInstanceId(rawName);
      providerName = parsed.provider;
      requestedHost = parsed.host;
    } catch (error) {
      const detail = error instanceof ProvidersConfigError ? error.message : '实例标识无效';
      stderr(`CONFIG_INVALID ${detail}`);
      return 1;
    }
  }

  let config: ProvidersFile;
  try {
    config = loadProvidersConfig(resolveProvidersPath(cwd));
  } catch (error) {
    const detail = error instanceof ProvidersConfigError ? error.message : '无法读取配置';
    stderr(`CONFIG_INVALID ${detail}`);
    return 1;
  }

  try {
    const result = await relay(
      {
        provider: providerName,
        prompt,
        timeoutMs: config.defaults.timeout_ms,
      },
      {
        hasProvider: (name) => Object.hasOwn(config.providers, name),
        isAvailableOnHost: (name) => {
          const provider = config.providers[name];
          return provider ? isAvailableOn(provider, host) : false;
        },
        requestedHost,
        host: host ?? '',
        events: noopEventSink,
        resolveAdapter: (name) => {
          const provider = config.providers[name];
          if (!provider) {
            return undefined;
          }
          return createAdapter(provider, name, { env });
        },
      },
    );

    if (!result.ok || result.text === undefined) {
      const code = result.error?.code ?? 'EMPTY_RESPONSE';
      const message = result.error?.message ?? '没有返回内容';
      stderr(`${code} ${message}`);
      return 1;
    }

    stdout(result.text);
    return 0;
  } catch (error) {
    if (error instanceof RelayError) {
      stderr(`${error.code} ${error.message}`);
      return 1;
    }
    throw error;
  }
}

async function resolvePrompt(
  promptParts: readonly string[],
  io: RunIo,
): Promise<string | undefined> {
  if (promptParts.length > 0) {
    return promptParts.join(' ');
  }
  if (!io.stdin || io.isTTY === true) {
    return undefined;
  }
  const text = (await readStream(io.stdin)).replace(/\r?\n$/, '');
  if (text.trim().length === 0) {
    return undefined;
  }
  return text;
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

function writeStdout(text: string): void {
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
}

function writeStderr(text: string): void {
  console.error(text);
}
