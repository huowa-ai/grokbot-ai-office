import { type AdapterPort, RelayError, type RelayRequest } from '@grokbot-ai-office/core';

export const cliAdapter: AdapterPort = {
  kind: 'cli',
  async call(_request: RelayRequest, _signal: AbortSignal): Promise<string> {
    throw new RelayError('CLI_NOT_INSTALLED', 'CLI 适配器将在后续步骤实现');
  },
  async selfcheck(): Promise<{ ok: boolean; detail: string }> {
    return { ok: false, detail: 'CLI 适配器将在后续步骤实现' };
  },
};
