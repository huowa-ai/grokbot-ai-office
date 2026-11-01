import { describe, expect, it } from 'vitest';

import { BOSS_DESK, seatPosition, slotPlacement, walkPosition } from '../src/scene/layout.js';
import { chooseTerminals } from '../src/scene/terminal-pool.js';

describe('layout', () => {
  it('本地区在云端区左侧，老板桌在前景', () => {
    const local = slotPlacement('local', 0);
    const cloud = slotPlacement('cloud', 0);
    expect(local.x).toBeLessThan(0);
    expect(cloud.x).toBeGreaterThan(0);
    expect(slotPlacement('local', 3).z).toBeLessThan(local.z);
    expect(BOSS_DESK.z).toBeGreaterThan(local.z);
    expect(seatPosition('local', 0).x).toBeGreaterThan(local.x);
  });

  it('交接走路从起点到终点再返回', () => {
    const start = { x: 0, y: 0, z: 0 };
    const end = { x: 10, y: 0, z: 0 };
    expect(walkPosition(start, end, 'outbound', 0)).toMatchObject({ x: 0, z: 0 });
    expect(walkPosition(start, end, 'outbound', 1).x).toBeCloseTo(10);
    expect(walkPosition(start, end, 'deliver', 0.2).x).toBeCloseTo(10);
    expect(walkPosition(start, end, 'return', 1).x).toBeCloseTo(0);
  });

  it('终端池优先聚焦和画面内的实例', () => {
    const chosen = chooseTerminals(
      [
        { instance: 'a@mac', visible: false },
        { instance: 'b@mac', visible: true },
        { instance: 'c@cloud', visible: true },
        { instance: 'd@cloud', visible: false },
        { instance: 'e@mac', visible: true },
        { instance: 'f@mac', visible: true },
      ],
      'd@cloud',
    );
    expect(chosen).toHaveLength(4);
    expect(chosen[0]).toBe('d@cloud');
    expect(chosen).toContain('b@mac');
    expect(chosen).not.toContain('a@mac');
  });
});
