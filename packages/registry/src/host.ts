import { ProvidersConfigError } from './load.js';
import { type ProviderConfig, hostNameSchema } from './schema.js';

const INSTANCE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface InstanceId {
  provider: string;
  host: string;
}

export function isAvailableOn(
  provider: Pick<ProviderConfig, 'hosts'>,
  host: string | undefined,
): boolean {
  if (provider.hosts === undefined) {
    return true;
  }
  if (host === undefined || host.length === 0) {
    return false;
  }
  return provider.hosts.includes(host);
}

export function readRelayHost(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env.RELAY_HOST;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return undefined;
  }
  const parsed = hostNameSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ProvidersConfigError([
      { path: 'RELAY_HOST', message: '主机名必须是小写字母、数字和连字符' },
    ]);
  }
  return parsed.data;
}

export function formatInstanceId(provider: string, host: string): string {
  assertInstancePart(provider, 'provider');
  assertInstancePart(host, 'host');
  return `${provider}@${host}`;
}

export function parseInstanceId(value: string): InstanceId {
  const separator = value.indexOf('@');
  if (separator <= 0 || separator !== value.lastIndexOf('@') || separator === value.length - 1) {
    throw new ProvidersConfigError([{ path: 'instance', message: '实例标识必须是 provider@host' }]);
  }
  const provider = value.slice(0, separator);
  const host = value.slice(separator + 1);
  assertInstancePart(provider, 'provider');
  assertInstancePart(host, 'host');
  return { provider, host };
}

function assertInstancePart(value: string, path: string): void {
  if (!INSTANCE_NAME.test(value)) {
    throw new ProvidersConfigError([
      { path, message: '实例标识的两边都必须是小写字母、数字和连字符' },
    ]);
  }
}
