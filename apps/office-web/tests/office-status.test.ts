import { describe, expect, it } from 'vitest';

import { officeStatus } from '../src/index.js';

describe('officeStatus', () => {
  it('officeStatus 只暴露只读模式和事件路径', () => {
    expect(officeStatus({ RELAY_EVENTS_PATH: '/tmp/events.jsonl' })).toEqual({
      mode: 'read-only',
      eventsPath: '/tmp/events.jsonl',
    });
  });
});
