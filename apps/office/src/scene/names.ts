export interface NameMap {
  hosts?: Record<string, string>;
  providers?: Record<string, string>;
  instances?: Record<string, string>;
}

const DEFAULT_HOSTS: Record<string, string> = {
  mac: '本地',
  local: '本地',
  cloud: '云端',
};

const DEFAULT_PROVIDERS: Record<string, string> = {
  codex: 'Codex',
  claude: 'Claude',
  gemini: 'Gemini',
  codebuddy: 'CodeBuddy',
  workbuddy: 'WorkBuddy',
  hermes: 'Hermes',
  openclaw: 'OpenClaw',
  deepseek: 'DeepSeek',
  kimi: 'Kimi',
  glm: 'GLM',
  minimax: 'MiniMax',
  openrouter: 'OpenRouter',
  'ollama-local': 'Ollama',
};

export function friendlyName(provider: string, host: string, map: NameMap = {}): string {
  const instance = host.length > 0 ? `${provider}@${host}` : provider;
  const exact = map.instances?.[instance];
  if (exact && exact.trim().length > 0) {
    return exact.trim();
  }
  const providerLabel =
    clean(map.providers?.[provider]) ?? DEFAULT_PROVIDERS[provider] ?? titleFromId(provider);
  const hostLabel = clean(map.hosts?.[host]) ?? DEFAULT_HOSTS[host];
  if (hostLabel) {
    return `${hostLabel}${providerLabel}`;
  }
  if (host.length === 0) {
    return providerLabel;
  }
  return `${providerLabel}@${host}`;
}

export function parseNameMap(value: unknown): NameMap {
  if (!isRecord(value)) {
    return {};
  }
  return {
    hosts: stringMap(value.hosts),
    providers: stringMap(value.providers),
    instances: stringMap(value.instances),
  };
}

export function splitInstance(instance: string): { provider: string; host: string } {
  const at = instance.indexOf('@');
  if (at <= 0 || at !== instance.lastIndexOf('@') || at === instance.length - 1) {
    return { provider: instance, host: '' };
  }
  return { provider: instance.slice(0, at), host: instance.slice(at + 1) };
}

function titleFromId(provider: string): string {
  return provider
    .split('-')
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function clean(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function stringMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const map: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' && item.trim().length > 0 && key.length < 200) {
      map[key] = item.trim();
    }
  }
  return map;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
