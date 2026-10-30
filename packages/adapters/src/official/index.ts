import { type AdapterPort, RelayError, type RelayRequest } from '@grokbot-ai-office/core';

export const officialAdapter: AdapterPort = {
  kind: 'http',
  async call(_request: RelayRequest, _signal: AbortSignal): Promise<string> {
    throw new RelayError('HTTP_ERROR', '官方 API 适配器将在后续步骤实现');
  },
  async selfcheck(): Promise<{ ok: boolean; detail: string }> {
    return { ok: false, detail: '官方 API 适配器将在后续步骤实现' };
  },
};
