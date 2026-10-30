import { describe, expect, it } from 'vitest';

import { type AdapterPort, RelayError, type RelayEvent, relay } from '@grokbot-ai-office/core';

const prompt = '请只在回答里出现这段提示，不要写进事件';

describe('relay', () => {
  it('relay 在提供者缺失时返回 PROVIDER_NOT_FOUND', async () => {
    let resolved = false;
    const result = await relay(
      { provider: 'missing', prompt },
      {
        hasProvider: () => false,
        resolveAdapter: () => {
          resolved = true;
          return undefined;
        },
      },
    );

    expect(resolved).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.text).toBeUndefined();
    expect(result.error).toBeInstanceOf(RelayError);
    expect(result.error?.code).toBe('PROVIDER_NOT_FOUND');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('relay 在适配器超时时返回 TIMEOUT 且事件不含提示原文', async () => {
    const events: RelayEvent[] = [];
    const adapter: AdapterPort = {
      kind: 'cli',
      call(_request, signal) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        });
      },
      async selfcheck() {
        return { ok: true, detail: 'unused' };
      },
    };

    const result = await relay(
      { provider: 'codex', prompt, timeoutMs: 30, replyTo: 'huowa' },
      {
        hasProvider: () => true,
        resolveAdapter: () => adapter,
        events: {
          async emit(event) {
            events.push(event);
          },
        },
      },
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('TIMEOUT');
    expect(events.map((event) => event.type)).toEqual(['started', 'replying_to', 'error']);
    expect(JSON.stringify(events)).not.toContain(prompt);
    expect(events[1]?.replyTo).toBe('huowa');
  });

  it('relay 原样转发适配器文本并在空响应时返回 EMPTY_RESPONSE', async () => {
    const answer = '适配器原文';
    const ok = await relay(
      { provider: 'codex', prompt },
      {
        hasProvider: () => true,
        resolveAdapter: () => ({
          kind: 'http',
          async call() {
            return answer;
          },
          async selfcheck() {
            return { ok: true, detail: 'unused' };
          },
        }),
      },
    );
    expect(ok).toMatchObject({ ok: true, text: answer });

    const empty = await relay(
      { provider: 'codex', prompt: '   ' },
      {
        hasProvider: () => true,
        resolveAdapter: () => ({
          kind: 'http',
          async call() {
            return '  ';
          },
          async selfcheck() {
            return { ok: true, detail: 'unused' };
          },
        }),
      },
    );
    expect(empty.ok).toBe(false);
    expect(empty.error?.code).toBe('EMPTY_RESPONSE');
    expect(empty.text).toBeUndefined();
  });
});
