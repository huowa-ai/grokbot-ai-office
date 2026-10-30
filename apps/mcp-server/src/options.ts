import type { AdapterPort } from '@grokbot-ai-office/core';
import type { ProviderConfig } from '@grokbot-ai-office/registry';

export interface RelayMcpOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /**
   * 测试注入。缺省时按注册表创建适配器，工具参数不能换成一条命令。
   */
  resolveAdapter?: (name: string, config: ProviderConfig) => AdapterPort | undefined;
  log?: (message: string) => void;
}

export interface ResolvedMcpOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  resolveAdapter?: RelayMcpOptions['resolveAdapter'];
  log: (message: string) => void;
}

export function resolveMcpOptions(options: RelayMcpOptions = {}): ResolvedMcpOptions {
  return {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    ...(options.resolveAdapter === undefined ? {} : { resolveAdapter: options.resolveAdapter }),
    log: options.log ?? ((message: string) => console.error(message)),
  };
}
