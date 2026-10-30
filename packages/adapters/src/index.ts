import { type AdapterPort, RelayError } from '@grokbot-ai-office/core';

import { createCliAdapter } from './cli/index.js';
import { createOfficialAdapter } from './official/index.js';
import { createOpenAiCompatibleAdapter } from './openai-compatible/index.js';
import type { AdapterConfig, AdapterRuntime } from './types.js';

export function createAdapter(
  config: AdapterConfig,
  providerName: string,
  runtime: AdapterRuntime = {},
): AdapterPort {
  switch (config.auth) {
    case 'subscription':
      return createCliAdapter(config, providerName, runtime);
    case 'api_key':
      return createOfficialAdapter(config, providerName, runtime);
    case 'openai_compatible':
      return createOpenAiCompatibleAdapter(config, providerName, runtime);
    default: {
      const unexpected: never = config;
      throw new RelayError('CONFIG_INVALID', `未知接入方式：${String(unexpected)}`, {
        isOperational: false,
      });
    }
  }
}

export { OFFICIAL_CHAT_VENDORS, OFFICIAL_VENDORS } from './official/vendors.js';
export { resolveWorkspace } from './workspace.js';
export type {
  AdapterConfig,
  AdapterRuntime,
  ApiKeyConfig,
  OpenAiCompatibleConfig,
  PtySpawn,
  SubscriptionConfig,
} from './types.js';
