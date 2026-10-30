import { createAdapter } from '@grokbot-ai-office/adapters';
import { RelayError, relay } from '@grokbot-ai-office/core';
import {
  ProvidersConfigError,
  type ProvidersFile,
  loadProvidersConfig,
  resolveProvidersPath,
} from '@grokbot-ai-office/registry';

export async function run(argv: readonly string[], cwd = process.cwd()): Promise<number> {
  const [name, ...promptParts] = argv;
  if (!name || promptParts.length === 0) {
    console.error('用法：ai-relay <名字> <提示>');
    return 1;
  }

  const prompt = promptParts.join(' ');
  let config: ProvidersFile;
  try {
    config = loadProvidersConfig(resolveProvidersPath(cwd));
  } catch (error) {
    const detail = error instanceof ProvidersConfigError ? error.message : '无法读取配置';
    console.error(`CONFIG_INVALID ${detail}`);
    return 1;
  }

  try {
    const result = await relay(
      {
        provider: name,
        prompt,
        timeoutMs: config.defaults.timeout_ms,
      },
      {
        hasProvider: (providerName) => Object.hasOwn(config.providers, providerName),
        resolveAdapter: (providerName) => {
          const provider = config.providers[providerName];
          if (!provider) {
            return undefined;
          }
          return createAdapter(provider.auth);
        },
      },
    );

    if (!result.ok || result.text === undefined) {
      const code = result.error?.code ?? 'EMPTY_RESPONSE';
      const message = result.error?.message ?? '没有返回内容';
      console.error(`${code} ${message}`);
      return 1;
    }

    console.log(result.text);
    return 0;
  } catch (error) {
    if (error instanceof RelayError) {
      console.error(`${error.code} ${error.message}`);
      return 1;
    }
    throw error;
  }
}
