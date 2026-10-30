import { describe, expect, it } from 'vitest';

import { parseClientEvent } from '../src/scene/events.js';
import type { ClientEvent } from '../src/scene/events.js';
import {
  applyEvent,
  applySnapshot,
  createSceneState,
  listAgents,
  tickScene,
} from '../src/scene/state.js';

function ev(partial: Partial<ClientEvent> & Pick<ClientEvent, 'type' | 'instance'>): ClientEvent {
  const [provider, host = ''] = partial.instance.split('@');
  return {
    v: 1,
    id: partial.id ?? `id_${partial.type}_${partial.instance}`,
    ts: partial.ts ?? '2026-10-30T00:00:00.000Z',
    type: partial.type,
    instance: partial.instance,
    provider: partial.provider ?? provider ?? partial.instance,
    host: partial.host ?? host,
    ...(partial.taskId ? { taskId: partial.taskId } : {}),
    payload: partial.payload ?? {},
  };
}

describe('scene state', () => {
  it('状态从工作切到卡住、待批准和空闲', () => {
    let state = createSceneState();
    state = applyEvent(
      state,
      ev({
        type: 'status',
        instance: 'codex@mac',
        payload: { state: 'working', source: 'lifecycle', taskPreview: '写摘要' },
      }),
    );
    state = applyEvent(
      state,
      ev({
        type: 'status',
        instance: 'codex@mac',
        id: 'stuck',
        payload: {
          state: 'stuck',
          source: 'lifecycle',
          code: 'HTTP_ERROR',
          reason: '上游没有返回',
        },
      }),
    );
    expect(listAgents(state)[0]).toMatchObject({
      status: 'stuck',
      stuck: { code: 'HTTP_ERROR', reason: '上游没有返回' },
    });

    state = applyEvent(
      state,
      ev({
        type: 'status',
        instance: 'codex@mac',
        id: 'wait',
        payload: {
          state: 'waiting_approval',
          source: 'hook',
          approvalId: 'appr_1',
          summary: '允许读取仓库',
        },
      }),
    );
    expect(listAgents(state)[0]).toMatchObject({
      status: 'waiting_approval',
      approval: { approvalId: 'appr_1', summary: '允许读取仓库' },
      stuck: undefined,
      hookActive: true,
    });

    state = applyEvent(
      state,
      ev({
        type: 'status',
        instance: 'codex@mac',
        id: 'idle',
        payload: { state: 'idle', source: 'lifecycle' },
      }),
    );
    expect(listAgents(state)[0]).toMatchObject({
      status: 'idle',
      approval: undefined,
      hookActive: false,
    });
  });

  it('钩子锁定时忽略启发式状态', () => {
    let state = applyEvent(
      createSceneState(),
      ev({
        type: 'status',
        instance: 'claude@mac',
        payload: { state: 'working', source: 'hook' },
      }),
    );
    state = applyEvent(
      state,
      ev({
        type: 'status',
        instance: 'claude@mac',
        id: 'guess',
        payload: {
          state: 'waiting_approval',
          source: 'heuristic',
          summary: '猜测',
          approvalId: 'x',
        },
      }),
    );
    expect(listAgents(state)[0]?.status).toBe('working');
  });

  it('交接按出发、送达、返回推进，减少动效时立即结束', () => {
    let state = applyEvent(
      createSceneState(),
      ev({
        type: 'status',
        instance: 'kimi@cloud',
        payload: { state: 'idle', source: 'lifecycle' },
      }),
    );
    state = applyEvent(
      state,
      ev({
        type: 'status',
        instance: 'codex@mac',
        id: 'walk',
        payload: {
          state: 'handoff',
          source: 'lifecycle',
          from: 'codex@mac',
          to: 'kimi@cloud',
          filePath: 'outbox/kimi@cloud/notes.txt',
        },
      }),
    );
    expect(listAgents(state).find((agent) => agent.instance === 'codex@mac')?.handoff?.phase).toBe(
      'outbound',
    );

    state = tickScene(state, 2400);
    expect(listAgents(state).find((agent) => agent.instance === 'codex@mac')?.handoff?.phase).toBe(
      'deliver',
    );
    state = tickScene(state, 400);
    expect(listAgents(state).find((agent) => agent.instance === 'codex@mac')?.handoff?.phase).toBe(
      'return',
    );
    state = tickScene(state, 2400);
    expect(
      listAgents(state).find((agent) => agent.instance === 'codex@mac')?.handoff,
    ).toBeUndefined();

    let reduced = applyEvent(
      createSceneState(),
      ev({
        type: 'status',
        instance: 'codex@mac',
        id: 'walk2',
        payload: {
          state: 'handoff',
          source: 'lifecycle',
          from: 'codex@mac',
          to: 'kimi@cloud',
          filePath: 'outbox/kimi@cloud/notes.txt',
        },
      }),
    );
    reduced = tickScene(reduced, 16, { reducedMotion: true });
    expect(listAgents(reduced)[0]?.handoff).toBeUndefined();
    expect(listAgents(reduced)[0]?.fit).toBe(1);
  });

  it('新实例按区域分配工位，快照会补上终端尾部', () => {
    let state = applyEvent(
      createSceneState(),
      ev({
        type: 'output_chunk',
        instance: 'codex@mac',
        payload: { seq: 1, text: 'hi' },
      }),
    );
    state = applyEvent(
      state,
      ev({
        type: 'output_chunk',
        instance: 'claude@mac',
        payload: { seq: 1, text: 'yo' },
      }),
    );
    state = applyEvent(
      state,
      ev({
        type: 'started',
        instance: 'gemini@cloud',
        payload: { promptPreview: '对照' },
      }),
    );
    const agents = listAgents(state);
    expect(agents.map((agent) => agent.instance)).toEqual([
      'codex@mac',
      'claude@mac',
      'gemini@cloud',
    ]);
    expect(agents[0]?.slot).toBe(0);
    expect(agents[1]?.slot).toBe(1);
    expect(agents[0]?.zone).toBe('local');
    expect(agents[2]?.zone).toBe('cloud');
    expect(agents[2]?.slot).toBe(0);

    state = applySnapshot(state, {
      v: 1,
      instances: [
        {
          instance: 'codex@mac',
          provider: 'codex',
          host: 'mac',
          status: 'working',
          terminalTail: 'hello',
        },
      ],
    });
    expect(listAgents(state)).toHaveLength(1);
    expect(listAgents(state)[0]).toMatchObject({ screen: 'hello', status: 'working', slot: 0 });
  });

  it('parseClientEvent 丢掉不完整事件', () => {
    expect(parseClientEvent({ v: 1, type: 'done' })).toBeUndefined();
    expect(
      parseClientEvent({
        v: 1,
        id: 'a',
        ts: '2026-10-30T00:00:00.000Z',
        type: 'done',
        instance: 'codex@mac',
        provider: 'codex',
        host: 'mac',
        payload: { durationMs: 10 },
      })?.type,
    ).toBe('done');
  });
});
