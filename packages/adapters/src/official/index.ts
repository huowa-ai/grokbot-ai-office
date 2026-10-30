import { type AdapterPort, RelayError } from '@grokbot-ai-office/core';

import {
  postChatCompletions,
  probeEndpoint,
  readRequiredApiKey,
} from '../http/chat-completions.js';
import type { AdapterRuntime, ApiKeyConfig } from '../types.js';
import { findVendor } from './vendors.js';

export function createOfficialAdapter(
  config: ApiKeyConfig,
  providerName: string,
  runtime: AdapterRuntime = {},
): AdapterPort {
  const env = runtime.env ?? process.env;

  return {
    kind: 'http',
    async call(request, signal) {
      const vendor = resolveVendor(config.vendor, providerName);
      if (vendor.style !== 'openai-chat' || vendor.baseUrl === undefined) {
        throw new RelayError('CONFIG_INVALID', vendor.note ?? `尚未支持 vendor：${vendor.id}`);
      }
      const model = config.model ?? vendor.defaultModel;
      if (model === undefined || model.length === 0) {
        throw new RelayError('CONFIG_INVALID', `提供者 ${providerName} 缺少 model`);
      }
      const apiKey = readRequiredApiKey(config.key_env, env);
      return postChatCompletions({
        baseUrl: vendor.baseUrl,
        model,
        prompt: request.prompt,
        apiKey,
        signal,
        fetchImpl: runtime.fetchImpl,
      });
    },
    async selfcheck() {
      if (config.vendor === undefined || config.vendor.trim().length === 0) {
        return { ok: false, detail: `提供者 ${providerName} 缺少 vendor` };
      }
      const vendor = findVendor(config.vendor);
      if (!vendor) {
        return { ok: false, detail: `尚未支持 vendor：${config.vendor}` };
      }
      if (vendor.style !== 'openai-chat' || vendor.baseUrl === undefined) {
        return { ok: false, detail: vendor.note ?? `尚未支持 vendor：${vendor.id}` };
      }
      const key = env[config.key_env];
      if (typeof key !== 'string' || key.trim().length === 0) {
        return { ok: false, detail: `${config.key_env} 未设置` };
      }
      const probe = await probeEndpoint(vendor.baseUrl, runtime.fetchImpl);
      return {
        ok: probe.ok,
        detail: probe.ok ? `已设置 ${config.key_env}，${probe.detail}` : probe.detail,
      };
    },
  };
}

function resolveVendor(vendorName: string | undefined, providerName: string) {
  if (vendorName === undefined || vendorName.trim().length === 0) {
    throw new RelayError('CONFIG_INVALID', `提供者 ${providerName} 缺少 vendor`);
  }
  const vendor = findVendor(vendorName);
  if (!vendor) {
    throw new RelayError('CONFIG_INVALID', `尚未支持 vendor：${vendorName}`);
  }
  return vendor;
}
