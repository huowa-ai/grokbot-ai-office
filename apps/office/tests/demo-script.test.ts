import { describe, expect, it } from 'vitest';

import { relayEventSchema } from '@grokbot-ai-office/core';

import { cuesUntil, demoDurationMs, demoScript } from '../src/scene/demo.js';
import { applyEvent, createSceneState, listAgents } from '../src/scene/state.js';

describe('demo script', () => {
  it('脚本里的事件都符合 v1，并且时间不倒退', () => {
    const script = demoScript();
    expect(script.length).toBeGreaterThan(10);
    let previous = -1;
    const providers = new Set<string>();
    const states = new Set<string>();
    for (const cue of script) {
      expect(cue.atMs).toBeGreaterThanOrEqual(previous);
      previous = cue.atMs;
      const parsed = relayEventSchema.safeParse(cue.event);
      expect(parsed.success, JSON.stringify(parsed.success ? '' : parsed.error.issues)).toBe(true);
      providers.add(cue.event.provider);
      if (cue.event.type === 'status') {
        const state = cue.event.payload.state;
        if (typeof state === 'string') {
          states.add(state);
        }
      }
    }
    expect(providers).toEqual(
      new Set([
        'codex',
        'claude',
        'gemini',
        'codebuddy',
        'hermes',
        'openclaw',
        'deepseek',
        'kimi',
        'glm',
        'workbuddy',
      ]),
    );
    expect(states).toEqual(new Set(['working', 'idle', 'waiting_approval', 'handoff', 'stuck']));
    expect(script.some((cue) => cue.event.type === 'output_chunk')).toBe(true);
    expect(demoDurationMs(script)).toBeGreaterThan(script.at(-1)?.atMs ?? 0);
  });

  it('播放到中途能看到多家形象，后到的实例会新开一席', () => {
    const script = demoScript();
    let state = createSceneState();
    const first = cuesUntil(script, 0, 0);
    for (const event of first.events) {
      state = applyEvent(state, event);
    }
    const early = listAgents(state).map((agent) => agent.instance);
    expect(early).toContain('codex@mac');
    expect(early).toContain('codex@cloud');
    expect(early).toContain('openclaw@mac');
    expect(early).not.toContain('glm@cloud');

    const later = cuesUntil(script, 5000, first.cursor);
    for (const event of later.events) {
      state = applyEvent(state, event);
    }
    expect(listAgents(state).some((agent) => agent.instance === 'glm@cloud')).toBe(true);
    expect(listAgents(state).find((agent) => agent.instance === 'hermes@cloud')?.status).toBe(
      'handoff',
    );
    expect(listAgents(state).find((agent) => agent.instance === 'deepseek@cloud')?.status).toBe(
      'stuck',
    );
  });
});
