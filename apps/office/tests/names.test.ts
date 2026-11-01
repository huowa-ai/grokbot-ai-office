import { describe, expect, it } from 'vitest';

import { friendlyName, parseNameMap } from '../src/scene/names.js';

describe('friendlyName', () => {
  it('同一提供者在本地和云端使用不同前缀', () => {
    expect(friendlyName('codex', 'mac')).toBe('本地Codex');
    expect(friendlyName('codex', 'cloud')).toBe('云端Codex');
  });

  it('实例映射优先于默认名字', () => {
    expect(
      friendlyName('codex', 'mac', {
        instances: { 'codex@mac': '工位甲' },
        providers: { codex: '代码' },
      }),
    ).toBe('工位甲');
  });

  it('未知主机保留 provider@host', () => {
    expect(friendlyName('ollama-local', 'lab')).toBe('Ollama@lab');
  });

  it('parseNameMap 只保留字符串', () => {
    expect(parseNameMap({ hosts: { mac: ' 本机 ', cloud: 1 }, providers: null })).toEqual({
      hosts: { mac: '本机' },
      providers: undefined,
      instances: undefined,
    });
  });
});
