import { type AdapterPort, RelayError } from '@grokbot-ai-office/core';

import {
  postChatCompletions,
  probeEndpoint,
  readOptionalApiKey,
} from '../http/chat-completions.js';
import type { AdapterRuntime, OpenAiCompatibleConfig } from '../types.js';

export function createOpenAiCompatibleAdapter(
  config: OpenAiCompatibleConfig,
  providerName: string,
  runtime: AdapterRuntime = {},
): AdapterPort {
  const env = runtime.env ?? process.env;

  return {
    kind: 'http',
    async call(request, signal) {
      if (config.base_url.trim().length === 0 || config.model.trim().length === 0) {
        throw new RelayError('CONFIG_INVALID', `提供者 ${providerName} 缺少 base_url 或 model`);
      }
      const apiKey = readOptionalApiKey(config.key_env, env);
      const text = await postChatCompletions({
        baseUrl: config.base_url,
        model: config.model,
        prompt: request.prompt,
        apiKey,
        signal,
        fetchImpl: runtime.fetchImpl,
      });
      if (request.onOutputChunk && text.length > 0) {
        await request.onOutputChunk(text);
      }
      return text;
    },
    async selfcheck() {
      if (typeof config.key_env === 'string' && config.key_env.length > 0) {
        const key = env[config.key_env];
        if (typeof key !== 'string' || key.trim().length === 0) {
          return { ok: false, detail: `${config.key_env} 未设置` };
        }
      }
      const probe = await probeEndpoint(config.base_url, runtime.fetchImpl);
      const keyNote =
        typeof config.key_env === 'string' && config.key_env.length > 0
          ? `已设置 ${config.key_env}，`
          : '';
      return {
        ok: probe.ok,
        detail: probe.ok ? `${keyNote}${probe.detail}` : probe.detail,
      };
    },
  };
}
