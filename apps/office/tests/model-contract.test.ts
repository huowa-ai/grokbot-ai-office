import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { mountAvatar, mountDesk, recolorPrimary } from '../src/render/avatar-factory.js';
import type { LoadedModel, ModelLibrary } from '../src/render/avatar-factory.js';
import {
  clipForStatus,
  deskModelId,
  modelStyleId,
  modelUrl,
} from '../src/render/model-contract.js';
import { resolveAgentStyle } from '../src/styles/agents.js';

function library(load: (url: string) => Promise<LoadedModel | undefined>): ModelLibrary {
  return {
    load(id: string) {
      return load(modelUrl(id));
    },
  };
}

describe('model contract', () => {
  it('按提供者选择模型，其余名字落到 generic', () => {
    expect(modelStyleId('codex')).toBe('codex');
    expect(modelStyleId('claude')).toBe('claude');
    expect(modelStyleId('gemini')).toBe('gemini');
    expect(modelStyleId('codebuddy')).toBe('workbuddy');
    expect(modelStyleId('workbuddy')).toBe('workbuddy');
    expect(modelStyleId('hermes')).toBe('hermes');
    expect(modelStyleId('openclaw')).toBe('openclaw');
    expect(modelStyleId('deepseek')).toBe('deepseek');
    expect(modelStyleId('kimi')).toBe('generic');
    expect(modelStyleId('glm')).toBe('generic');
    expect(modelUrl('codex')).toBe('/models/codex.glb');
    expect(modelUrl('desk_cloud')).toBe('/models/desk_cloud.glb');
  });

  it('本地区和云端使用不同的桌子模型', () => {
    expect(deskModelId('local')).toBe('desk_local');
    expect(deskModelId('other')).toBe('desk_local');
    expect(deskModelId('cloud')).toBe('desk_cloud');
  });

  it('状态对应约定的动画片段', () => {
    expect(clipForStatus('idle', false)).toBe('Sleep');
    expect(clipForStatus('working', false)).toBe('Typing');
    expect(clipForStatus('stuck', false)).toBe('Stuck');
    expect(clipForStatus('waiting_approval', false)).toBe('RaiseHand');
    expect(clipForStatus('unknown', false)).toBe('Idle');
    expect(clipForStatus('idle', true)).toBe('Walk');
  });

  it('文件缺失时继续用程序形象', async () => {
    const style = resolveAgentStyle('codex', 'mac');
    const avatar = mountAvatar(
      style,
      library(async () => undefined),
    );
    const desk = mountDesk(
      style,
      library(async () => undefined),
    );
    await Promise.all([avatar.ready, desk.ready]);
    expect(avatar.model).toBe('procedural');
    expect(desk.model).toBe('procedural');
    expect(desk.screenSize.width).toBeGreaterThan(0.7);
    avatar.pose('working', 1, 0.016, false, false);
    avatar.dispose();
    desk.dispose();
  });

  it('有骨骼片段时用片段，只有节点时做程序动作', async () => {
    const clipStyle = resolveAgentStyle('hermes', 'cloud');
    const scene = new THREE.Group();
    const head = new THREE.Group();
    head.name = 'Head';
    scene.add(head);
    const clip = new THREE.AnimationClip('Typing', 0.4, [
      new THREE.QuaternionKeyframeTrack('Head.quaternion', [0], [0, 0, 0, 1]),
    ]);
    const avatar = mountAvatar(
      clipStyle,
      library(async (url) =>
        url.endsWith('/hermes.glb') ? { scene, animations: [clip] } : undefined,
      ),
    );
    await avatar.ready;
    expect(avatar.model).toBe('clip');
    avatar.pose('working', 0, 0.016, false, true);
    avatar.dispose();

    const nodeStyle = resolveAgentStyle('openclaw', 'mac');
    const nodes = new THREE.Group();
    const arm = new THREE.Group();
    arm.name = 'ArmR';
    nodes.add(arm);
    const posed = mountAvatar(
      nodeStyle,
      library(async (url) =>
        url.endsWith('/openclaw.glb') ? { scene: nodes, animations: [] } : undefined,
      ),
    );
    await posed.ready;
    expect(posed.model).toBe('nodes');
    posed.pose('waiting_approval', 0, 0.016, false, true);
    const posedArm = posed.group.getObjectByName('ArmR');
    expect(posedArm?.rotation.x).toBeLessThan(-2);
    posed.dispose();
  });

  it('generic 的 MAT_Primary 使用哈希配色', async () => {
    const style = resolveAgentStyle('kimi', 'mac');
    const scene = new THREE.Group();
    const material = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    material.name = 'MAT_Primary';
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.2, 0.4), material);
    body.name = 'Body';
    scene.add(body);
    const avatar = mountAvatar(
      style,
      library(async (url) =>
        url.endsWith('/generic.glb') ? { scene, animations: [] } : undefined,
      ),
    );
    await avatar.ready;
    expect(avatar.model).toBe('nodes');
    let painted = '';
    avatar.group.traverse((node) => {
      if (
        node instanceof THREE.Mesh &&
        !Array.isArray(node.material) &&
        node.material.name === 'MAT_Primary'
      ) {
        painted = `#${node.material.color.getHexString()}`;
      }
    });
    expect(painted).toBe(style.palette.primary.toLowerCase());
    expect(material.color.getHexString()).toBe('ffffff');
    const swatch = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    expect(recolorPrimary(swatch, '#112233')).toBe(1);
    avatar.dispose();
  });

  it('桌子模型的 Screen 成为终端锚点，缺少 Screen 则退回', async () => {
    const cloud = resolveAgentStyle('gemini', 'cloud');
    const deskScene = new THREE.Group();
    const screen = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.45, 0.04),
      new THREE.MeshLambertMaterial(),
    );
    screen.name = 'Screen';
    deskScene.add(screen);
    const desk = mountDesk(
      cloud,
      library(async (url) =>
        url.endsWith('/desk_cloud.glb') ? { scene: deskScene, animations: [] } : undefined,
      ),
    );
    await desk.ready;
    expect(desk.model).toBe('static');
    expect(desk.screenAnchor.parent?.name).toBe('Screen');
    expect(desk.screenSize.width).toBeGreaterThan(0.7);
    expect(desk.screenSize.height).toBeGreaterThan(0.3);
    desk.dispose();

    const local = resolveAgentStyle('codex', 'mac');
    const bare = new THREE.Group();
    bare.add(new THREE.Mesh(new THREE.BoxGeometry(1, 0.7, 0.6), new THREE.MeshLambertMaterial()));
    const fallback = mountDesk(
      local,
      library(async (url) =>
        url.endsWith('/desk_local.glb') ? { scene: bare, animations: [] } : undefined,
      ),
    );
    await fallback.ready;
    expect(fallback.model).toBe('procedural');
    expect(fallback.screenAnchor.parent?.name).not.toBe('Screen');
    fallback.dispose();
  });
});
