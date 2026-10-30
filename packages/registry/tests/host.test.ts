import { describe, expect, it } from 'vitest';

import {
  ProvidersConfigError,
  formatInstanceId,
  isAvailableOn,
  parseInstanceId,
  readRelayHost,
} from '@grokbot-ai-office/registry';

describe('isAvailableOn', () => {
  it('isAvailableOn 在未声明 hosts 时对任意主机返回 true', () => {
    expect(isAvailableOn({}, 'mac')).toBe(true);
    expect(isAvailableOn({}, undefined)).toBe(true);
  });

  it('isAvailableOn 只在列出的主机上返回 true', () => {
    const provider = { hosts: ['cloud'] };
    expect(isAvailableOn(provider, 'cloud')).toBe(true);
    expect(isAvailableOn(provider, 'mac')).toBe(false);
    expect(isAvailableOn(provider, undefined)).toBe(false);
    expect(isAvailableOn({ hosts: [] }, 'mac')).toBe(false);
  });
});

describe('instance id', () => {
  it('formatInstanceId 与 parseInstanceId 能组成 provider@host', () => {
    expect(formatInstanceId('codex', 'mac')).toBe('codex@mac');
    expect(parseInstanceId('codex@cloud')).toEqual({ provider: 'codex', host: 'cloud' });
    expect(parseInstanceId(formatInstanceId('openclaw', 'cloud'))).toEqual({
      provider: 'openclaw',
      host: 'cloud',
    });
  });

  it('parseInstanceId 拒绝缺少主机或不合法的名字', () => {
    expect(() => parseInstanceId('codex')).toThrow(ProvidersConfigError);
    expect(() => parseInstanceId('Codex@mac')).toThrow(ProvidersConfigError);
    expect(() => parseInstanceId('codex@Mac')).toThrow(ProvidersConfigError);
    expect(() => formatInstanceId('codex', 'Cloud')).toThrow(ProvidersConfigError);
  });
});

describe('readRelayHost', () => {
  it('readRelayHost 读取合法主机名并忽略空值', () => {
    expect(readRelayHost({ RELAY_HOST: 'mac' })).toBe('mac');
    expect(readRelayHost({ RELAY_HOST: 'cloud' })).toBe('cloud');
    expect(readRelayHost({})).toBeUndefined();
    expect(readRelayHost({ RELAY_HOST: '   ' })).toBeUndefined();
  });

  it('readRelayHost 拒绝不合法的主机名且不回显原值', () => {
    expect(() => readRelayHost({ RELAY_HOST: 'Mac' })).toThrow(ProvidersConfigError);
    try {
      readRelayHost({ RELAY_HOST: 'Mac' });
    } catch (error) {
      expect(error).toBeInstanceOf(ProvidersConfigError);
      if (error instanceof ProvidersConfigError) {
        expect(error.message).not.toContain('Mac');
      }
    }
  });
});
