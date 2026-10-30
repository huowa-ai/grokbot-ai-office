import { type AdapterPort, RelayError } from '@grokbot-ai-office/core';

import { cliAdapter } from './cli/index.js';
import { officialAdapter } from './official/index.js';
import { openaiCompatibleAdapter } from './openai-compatible/index.js';

export type AdapterAuth = 'subscription' | 'api_key' | 'openai_compatible';

export function createAdapter(auth: AdapterAuth): AdapterPort {
  switch (auth) {
    case 'subscription':
      return cliAdapter;
    case 'api_key':
      return officialAdapter;
    case 'openai_compatible':
      return openaiCompatibleAdapter;
    default: {
      const unexpected: never = auth;
      throw new RelayError('CONFIG_INVALID', `未知接入方式：${String(unexpected)}`, {
        isOperational: false,
      });
    }
  }
}

export { cliAdapter, officialAdapter, openaiCompatibleAdapter };
