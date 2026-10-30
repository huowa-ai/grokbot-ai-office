import { type AdapterPort, RelayError, type RelayRequest } from '@grokbot-ai-office/core';

import { postAnthropicMessage } from '../http/anthropic.js';
import {
  postChatCompletions,
  probeEndpoint,
  readRequiredApiKey,
} from '../http/chat-completions.js';
import { postGeminiGenerate } from '../http/gemini.js';
import type { AdapterRuntime, ApiKeyConfig } from '../types.js';
import { type VendorDefinition, findVendor } from './vendors.js';

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
      const model = config.model ?? vendor.defaultModel;
      if (model.length === 0) {
        throw new RelayError('CONFIG_INVALID', `提供者 ${providerName} 缺少 model`);
      }
      const apiKey = readRequiredApiKey(resolveKeyEnv(config, vendor), env);
      switch (vendor.style) {
        case 'openai-chat': {
          if (vendor.baseUrl === undefined) {
            throw new RelayError('CONFIG_INVALID', `尚未支持 vendor：${vendor.id}`);
          }
          return emitAnswer(
            request,
            await postChatCompletions({
              baseUrl: vendor.baseUrl,
              model,
              prompt: request.prompt,
              apiKey,
              signal,
              fetchImpl: runtime.fetchImpl,
            }),
          );
        }
        case 'anthropic-messages':
          return emitAnswer(
            request,
            await postAnthropicMessage({
              model,
              prompt: request.prompt,
              apiKey,
              signal,
              fetchImpl: runtime.fetchImpl,
            }),
          );
        case 'gemini-generate':
          return emitAnswer(
            request,
            await postGeminiGenerate({
              model,
              prompt: request.prompt,
              apiKey,
              signal,
              fetchImpl: runtime.fetchImpl,
            }),
          );
        default: {
          const unexpected: never = vendor.style;
          throw new RelayError('CONFIG_INVALID', `尚未支持 vendor：${String(unexpected)}`, {
            isOperational: false,
          });
        }
      }
    },
    async selfcheck() {
      if (config.vendor === undefined || config.vendor.trim().length === 0) {
        return { ok: false, detail: `提供者 ${providerName} 缺少 vendor` };
      }
      const vendor = findVendor(config.vendor);
      if (!vendor) {
        return { ok: false, detail: `尚未支持 vendor：${config.vendor}` };
      }
      const keyEnv = resolveKeyEnv(config, vendor);
      const key = env[keyEnv];
      if (typeof key !== 'string' || key.trim().length === 0) {
        return { ok: false, detail: `${keyEnv} 未设置` };
      }
      const probe = await probeEndpoint(vendor.probeUrl, runtime.fetchImpl);
      return {
        ok: probe.ok,
        detail: probe.ok ? `已设置 ${keyEnv}，${probe.detail}` : probe.detail,
      };
    },
  };
}

function resolveVendor(vendorName: string | undefined, providerName: string): VendorDefinition {
  if (vendorName === undefined || vendorName.trim().length === 0) {
    throw new RelayError('CONFIG_INVALID', `提供者 ${providerName} 缺少 vendor`);
  }
  const vendor = findVendor(vendorName);
  if (!vendor) {
    throw new RelayError('CONFIG_INVALID', `尚未支持 vendor：${vendorName}`);
  }
  return vendor;
}

async function emitAnswer(request: RelayRequest, text: string): Promise<string> {
  if (request.onOutputChunk && text.length > 0) {
    await request.onOutputChunk(text);
  }
  return text;
}

function resolveKeyEnv(config: ApiKeyConfig, vendor: VendorDefinition): string {
  if (config.key_env.trim().length > 0) {
    return config.key_env;
  }
  return vendor.defaultKeyEnv;
}
