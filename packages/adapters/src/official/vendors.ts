export type VendorStyle = 'openai-chat' | 'unsupported';

export interface VendorDefinition {
  id: string;
  style: VendorStyle;
  baseUrl?: string;
  defaultModel?: string;
  note?: string;
}

export const VENDORS: Readonly<Record<string, VendorDefinition>> = {
  deepseek: {
    id: 'deepseek',
    style: 'openai-chat',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
  },
  kimi: {
    id: 'kimi',
    style: 'openai-chat',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
  },
  glm: {
    id: 'glm',
    style: 'openai-chat',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
  },
  anthropic: {
    id: 'anthropic',
    style: 'unsupported',
    note: 'Anthropic Messages API 与 OpenAI chat completions 不同，留待单独接入',
  },
  gemini: {
    id: 'gemini',
    style: 'unsupported',
    note: 'Gemini generateContent 与 OpenAI chat completions 不同，留待单独接入',
  },
};

export const OFFICIAL_CHAT_VENDORS = ['deepseek', 'kimi', 'glm'] as const;

export function findVendor(vendor: string): VendorDefinition | undefined {
  return VENDORS[vendor] ?? VENDORS[vendor.toLowerCase()];
}
