import { describe, expect, it } from 'vitest';

import {
  backoffMs,
  createLinkState,
  eventUrls,
  noteConnectFailure,
  noteConnectStart,
  noteConnectSuccess,
  noteDemo,
  noteStop,
  readSession,
  sanitizeServerUrl,
  stripTokenFromSearch,
  writeSession,
} from '../src/scene/reconnect.js';

describe('reconnect', () => {
  it('失败后退避增长并封顶，成功后清零', () => {
    let link = noteConnectStart(createLinkState());
    expect(link.phase).toBe('connecting');
    link = noteConnectFailure(link);
    expect(link).toMatchObject({ phase: 'reconnecting', attempt: 1, nextDelayMs: 500 });
    link = noteConnectFailure(link);
    expect(link.nextDelayMs).toBe(1000);
    link = noteConnectFailure(link);
    expect(link.nextDelayMs).toBe(2000);
    expect(backoffMs(12)).toBe(15_000);
    link = noteConnectSuccess(link);
    expect(link).toEqual({ phase: 'live', attempt: 0, nextDelayMs: 0 });
  });

  it('停止和演示之后不再重连', () => {
    expect(noteConnectFailure(noteStop(createLinkState())).phase).toBe('stopped');
    expect(noteConnectStart(noteDemo()).phase).toBe('demo');
  });

  it('抖动只增加不超过两成的延迟', () => {
    expect(backoffMs(1, () => 1)).toBe(600);
    expect(backoffMs(2, () => 1)).toBe(1200);
  });

  it('页面查询里的令牌会被丢掉，不会写入会话', () => {
    const stripped = stripTokenFromSearch('?demo=1&token=should-not-stick&x=1');
    expect(stripped.hadToken).toBe(true);
    expect(stripped.search).toBe('?demo=1&x=1');
    expect(stripped.search).not.toContain('should-not-stick');
    expect(sanitizeServerUrl('http://user:pass@127.0.0.1:8787/state?token=abc')).toBeUndefined();
    expect(sanitizeServerUrl('http://127.0.0.1:8787/state?token=abc')).toBe(
      'http://127.0.0.1:8787',
    );
  });

  it('令牌只进给定的存储，WebSocket 地址单独携带', () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
    };
    writeSession(storage, { origin: 'http://127.0.0.1:8787', token: 'local-only' });
    expect(readSession(storage)).toEqual({
      origin: 'http://127.0.0.1:8787',
      token: 'local-only',
    });
    expect([...memory.keys()].every((key) => key.startsWith('grokbot.office.'))).toBe(true);
    const urls = eventUrls('http://127.0.0.1:8787', 'local-only');
    expect(urls.state).toBe('http://127.0.0.1:8787/state');
    expect(urls.socket).toBe('ws://127.0.0.1:8787/events?token=local-only');
  });
});
