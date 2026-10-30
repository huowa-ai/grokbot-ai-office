import { describe, expect, it } from 'vitest';

import {
  OFFICE_ACCESSORIES,
  OFFICE_BODIES,
  OFFICE_DESK_PROPS,
  OFFICE_IDLE_POSES,
  OFFICE_TYPING,
} from '@grokbot-ai-office/registry';

import {
  ACCESSORIES,
  BODY_SHAPES,
  DESK_PROPS,
  IDLE_POSES,
  TYPING_FLAVORS,
  emptyCatalog,
  hashProvider,
  resolveAgentStyle,
} from '../src/styles/agents.js';
import { mergeCatalogs, parseStyleCatalog } from '../src/styles/catalog.js';

describe('agent styles', () => {
  it('内置形象互不相同，workbuddy 与 codebuddy 相同', () => {
    const codex = resolveAgentStyle('codex', 'mac');
    const claude = resolveAgentStyle('claude', 'mac');
    const gemini = resolveAgentStyle('gemini', 'cloud');
    const buddy = resolveAgentStyle('codebuddy', 'mac');
    const work = resolveAgentStyle('workbuddy', 'mac');
    const hermes = resolveAgentStyle('hermes', 'cloud');
    const claw = resolveAgentStyle('openclaw', 'mac');
    const whale = resolveAgentStyle('deepseek', 'cloud');

    expect(codex).toMatchObject({ body: 'robot', accessory: 'antenna', source: 'builtin' });
    expect(codex.palette.primary).toBe('#14615f');
    expect(claude).toMatchObject({ body: 'round', accessory: 'scarf' });
    expect(gemini).toMatchObject({ body: 'twin', accessory: 'sparkles' });
    expect(buddy.body).toBe('headset');
    expect(work.body).toBe(buddy.body);
    expect(work.palette).toEqual(buddy.palette);
    expect(hermes).toMatchObject({ body: 'messenger', accessory: 'wings' });
    expect(claw).toMatchObject({ body: 'lobster', accessory: 'claws' });
    expect(whale).toMatchObject({ body: 'whale', accessory: 'spout' });
  });

  it('覆盖只改给定字段，哈希回退稳定且可重复', () => {
    const catalog = parseStyleCatalog({
      providers: {
        codex: { body: 'whale', desk_prop: 'wave', bezel: '#001122' },
      },
      instances: {
        'codex@cloud': { nameTag: '#abcdef', palette: { accent: '#112233' } },
      },
    });
    const local = resolveAgentStyle('codex', 'mac', catalog);
    const cloud = resolveAgentStyle('codex', 'cloud', catalog);
    expect(local).toMatchObject({
      source: 'override',
      body: 'whale',
      deskProp: 'wave',
      bezel: '#001122',
      accessory: 'antenna',
    });
    expect(local.palette.primary).toBe('#14615f');
    expect(cloud.nameTag).toBe('#abcdef');
    expect(cloud.palette.accent).toBe('#112233');
    expect(cloud.palette.primary).toBe('#14615f');

    const kimi = resolveAgentStyle('kimi', 'mac');
    const glm = resolveAgentStyle('glm', 'cloud');
    expect(kimi.source).toBe('hash');
    expect(glm.source).toBe('hash');
    expect(kimi.body === 'blob' || kimi.body === 'round').toBe(true);
    expect(resolveAgentStyle('kimi', 'mac')).toEqual(kimi);
    expect(hashProvider('kimi')).not.toBe(hashProvider('glm'));
    expect(resolveAgentStyle('kimi', 'cloud').palette).toEqual(kimi.palette);
    expect(resolveAgentStyle('kimi', 'cloud').body).toEqual(kimi.body);
  });

  it('同一角色在 mac 和 cloud 上身体相同，工位色不同', () => {
    const mac = resolveAgentStyle('codex', 'mac');
    const cloud = resolveAgentStyle('codex', 'cloud');
    expect(mac.body).toBe(cloud.body);
    expect(mac.palette).toEqual(cloud.palette);
    expect(mac.accessory).toBe(cloud.accessory);
    expect(mac.hostAccent.zone).toBe('local');
    expect(cloud.hostAccent.zone).toBe('cloud');
    expect(mac.hostAccent.desk).not.toBe(cloud.hostAccent.desk);
    expect(mac.hostAccent.lamp).not.toBe(cloud.hostAccent.halo);
  });

  it('后写入的样式目录按字段覆盖', () => {
    const merged = mergeCatalogs(
      parseStyleCatalog({ providers: { kimi: { body: 'blob', bezel: '#112233' } } }),
      parseStyleCatalog({ providers: { kimi: { deskProp: 'mug' } } }),
    );
    expect(merged.providers.kimi).toEqual({ body: 'blob', bezel: '#112233', deskProp: 'mug' });
    expect(emptyCatalog().providers).toEqual({});
  });

  it('形象枚举与注册表一致', () => {
    expect([...OFFICE_BODIES]).toEqual([...BODY_SHAPES]);
    expect([...OFFICE_ACCESSORIES]).toEqual([...ACCESSORIES]);
    expect([...OFFICE_DESK_PROPS]).toEqual([...DESK_PROPS]);
    expect([...OFFICE_IDLE_POSES]).toEqual([...IDLE_POSES]);
    expect([...OFFICE_TYPING]).toEqual([...TYPING_FLAVORS]);
  });
});
