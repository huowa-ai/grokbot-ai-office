export type VendorStyle = 'openai-chat' | 'anthropic-messages' | 'gemini-generate';

export interface VendorDefinition {
  id: string;
  style: VendorStyle;
  probeUrl: string;
  baseUrl?: string;
  defaultModel: string;
  defaultKeyEnv: string;
}

export const VENDORS: Readonly<Record<string, VendorDefinition>> = {
  deepseek: {
    id: 'deepseek',
    style: 'openai-chat',
    baseUrl: 'https://api.deepseek.com',
    probeUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    defaultKeyEnv: 'DEEPSEEK_API_KEY',
  },
  kimi: {
    id: 'kimi',
    style: 'openai-chat',
    baseUrl: 'https://api.moonshot.cn/v1',
    probeUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    defaultKeyEnv: 'MOONSHOT_API_KEY',
  },
  glm: {
    id: 'glm',
    style: 'openai-chat',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    probeUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    defaultKeyEnv: 'ZHIPU_API_KEY',
  },
  anthropic: {
    id: 'anthropic',
    style: 'anthropic-messages',
    probeUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-5',
    defaultKeyEnv: 'ANTHROPIC_API_KEY',
  },
  gemini: {
    id: 'gemini',
    style: 'gemini-generate',
    probeUrl: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-2.5-flash',
    defaultKeyEnv: 'GEMINI_API_KEY',
  },
};

export const OFFICIAL_CHAT_VENDORS = ['deepseek', 'kimi', 'glm'] as const;

export const OFFICIAL_VENDORS = ['deepseek', 'kimi', 'glm', 'anthropic', 'gemini'] as const;

export function findVendor(vendor: string): VendorDefinition | undefined {
  return VENDORS[vendor] ?? VENDORS[vendor.toLowerCase()];
}
