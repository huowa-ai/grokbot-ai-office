import { describe, expect, it } from 'vitest';

import { EVENT_TYPES, resolveEventsPath } from '@grokbot-ai-office/events';

describe('resolveEventsPath', () => {
  it('resolveEventsPath 在未设置变量时使用 ~/.grokbot-ai-office/events.jsonl', () => {
    expect(resolveEventsPath({}, '/home/example')).toBe(
      '/home/example/.grokbot-ai-office/events.jsonl',
    );
  });

  it('resolveEventsPath 优先使用 RELAY_EVENTS_PATH', () => {
    expect(resolveEventsPath({ RELAY_EVENTS_PATH: '/tmp/custom.jsonl' }, '/home/example')).toBe(
      '/tmp/custom.jsonl',
    );
  });

  it('EVENT_TYPES 覆盖 v1 的六种事件', () => {
    expect([...EVENT_TYPES]).toEqual([
      'started',
      'replying_to',
      'done',
      'error',
      'output_chunk',
      'status',
    ]);
  });
});
