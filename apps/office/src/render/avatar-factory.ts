import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

import type { AgentStatus } from '../scene/events.js';
import type { ResolvedStyle } from '../styles/agents.js';
import { type AvatarRig, buildAvatar, createCarryProp, poseAvatar } from './avatar.js';
import { buildDesk } from './desk.js';
import {
  AVATAR_NODE_NAMES,
  type ClipName,
  PRIMARY_MATERIAL,
  SCREEN_NODE,
  clipForStatus,
  deskModelId,
  isClipName,
  modelStyleId,
  modelUrl,
} from './model-contract.js';
import { SCREEN_WORLD_HEIGHT, SCREEN_WORLD_WIDTH } from './screen.js';

export interface LoadedModel {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

export interface ModelLoader {
  load(url: string): Promise<LoadedModel | undefined>;
}

export interface ModelLibrary {
  load(id: string): Promise<LoadedModel | undefined>;
}

export type ModelDriver = 'procedural' | 'clip' | 'nodes' | 'static';

export interface AvatarMount {
  group: THREE.Group;
  model: ModelDriver;
  ready: Promise<void>;
  pose(status: AgentStatus, time: number, dt: number, walking: boolean, reduced: boolean): void;
  dispose(): void;
}

export interface DeskMount {
  group: THREE.Group;
  model: ModelDriver;
  screenAnchor: THREE.Object3D;
  screenSize: { width: number; height: number };
  beacon: THREE.Mesh;
  beaconMat: THREE.MeshLambertMaterial;
  ownMaterials: THREE.Material[];
  ready: Promise<void>;
  dispose(): void;
}

const AVATAR_HEIGHT = 1.05;
const DESK_WIDTH = 1.55;

export function createModelLibrary(loader: ModelLoader = createDefaultModelLoader()): ModelLibrary {
  const cache = new Map<string, Promise<LoadedModel | undefined>>();
  return {
    load(id: string) {
      const url = modelUrl(id);
      const cached = cache.get(url);
      if (cached) {
        return cached;
      }
      const pending = loader.load(url);
      cache.set(url, pending);
      return pending;
    },
  };
}

export function createDefaultModelLoader(fetchImpl: typeof fetch = fetch): ModelLoader {
  return {
    async load(url: string) {
      try {
        const response = await fetchImpl(url);
        if (response.status === 404) {
          return undefined;
        }
        if (!response.ok) {
          console.error('办公室模型无法读取，已使用程序形象', url, response.status);
          return undefined;
        }
        const buffer = await response.arrayBuffer();
        const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
        const base = url.slice(0, url.lastIndexOf('/') + 1);
        const gltf = await new GLTFLoader().parseAsync(buffer, base);
        return { scene: gltf.scene, animations: gltf.animations };
      } catch (error) {
        console.error('办公室模型无法读取，已使用程序形象', url, error);
        return undefined;
      }
    },
  };
}

export function mountAvatar(style: ResolvedStyle, library: ModelLibrary): AvatarMount {
  const root = new THREE.Group();
  const procedural = buildAvatar(style);
  root.add(procedural.group);
  const carry = createCarryProp(style.palette.accent);
  root.add(carry);
  let model: ModelDriver = 'procedural';
  let binding: GltfAvatar | undefined;
  let disposed = false;
  const owned: THREE.Material[] = [];

  const ready = library
    .load(modelStyleId(style.provider))
    .then((loaded) => {
      if (disposed || !loaded) {
        return;
      }
      const copy = adoptModel(loaded.scene, owned);
      const nodes = findAvatarNodes(copy);
      const clips = contractClips(loaded.animations);
      if (modelStyleId(style.provider) === 'generic') {
        recolorPrimary(copy, style.palette.primary);
      }
      fitHeight(copy, AVATAR_HEIGHT);
      root.add(copy);
      root.remove(procedural.group);
      disposeGeometries(procedural.group);
      if (clips.length > 0) {
        binding = bindClips(copy, clips);
        model = 'clip';
        return;
      }
      if (nodes) {
        binding = { kind: 'nodes', model: copy, nodes, rig: namedRig(copy, nodes) };
        model = 'nodes';
        return;
      }
      binding = { kind: 'static', model: copy };
      model = 'static';
    })
    .catch((error: unknown) => {
      console.error('办公室角色模型无法换上，已使用程序形象', error);
    });

  return {
    group: root,
    get model() {
      return model;
    },
    ready,
    pose(status, time, dt, walking, reduced) {
      carry.visible = model !== 'procedural' && walking;
      if (model === 'clip' && binding?.kind === 'clip') {
        playClip(binding, clipForStatus(status, walking), dt, reduced);
        return;
      }
      if (model === 'nodes' && binding?.kind === 'nodes') {
        poseAvatar(binding.rig, style, status, time, walking, reduced);
        poseLegs(binding.nodes, time, walking, reduced);
        return;
      }
      if (model === 'static') {
        return;
      }
      poseAvatar(procedural, style, status, time, walking, reduced);
    },
    dispose() {
      disposed = true;
      if (binding?.kind === 'clip') {
        binding.mixer.stopAllAction();
      }
      if (model === 'procedural') {
        disposeGeometries(procedural.group);
      }
      disposeGeometries(carry);
      for (const material of owned) {
        material.dispose();
      }
    },
  };
}

export function mountDesk(style: ResolvedStyle, library: ModelLibrary): DeskMount {
  const procedural = buildDesk(style);
  const root = new THREE.Group();
  root.add(procedural.group);
  const screenSize = { width: SCREEN_WORLD_WIDTH, height: SCREEN_WORLD_HEIGHT };
  let model: ModelDriver = 'procedural';
  let disposed = false;
  const gltfMaterials: THREE.Material[] = [];

  const ready = library
    .load(deskModelId(style.hostAccent.zone))
    .then((loaded) => {
      if (disposed || !loaded) {
        return;
      }
      const copy = adoptModel(loaded.scene, gltfMaterials);
      root.add(copy);
      fitWidth(copy, DESK_WIDTH);
      const screen = findNamed(copy, SCREEN_NODE);
      if (!screen) {
        console.error(
          '办公室桌子模型缺少 Screen，已使用程序桌子',
          deskModelId(style.hostAccent.zone),
        );
        root.remove(copy);
        disposeOwned(gltfMaterials);
        gltfMaterials.length = 0;
        return;
      }
      const face = measureFace(screen);
      screenSize.width = face.width;
      screenSize.height = face.height;
      screen.attach(procedural.screenAnchor);
      procedural.screenAnchor.position.set(0, 0, face.forward);
      procedural.screenAnchor.rotation.set(0, 0, 0);
      procedural.screenAnchor.scale.set(1, 1, 1);
      root.attach(procedural.beacon);
      procedural.beacon.position.set(0.62, 0.9, 0.35);
      root.remove(procedural.group);
      disposeGeometries(procedural.group);
      model = 'static';
    })
    .catch((error: unknown) => {
      console.error('办公室桌子模型无法换上，已使用程序桌子', error);
    });

  return {
    group: root,
    get model() {
      return model;
    },
    screenAnchor: procedural.screenAnchor,
    screenSize,
    beacon: procedural.beacon,
    beaconMat: procedural.beaconMat,
    ownMaterials: procedural.ownMaterials,
    ready,
    dispose() {
      disposed = true;
      for (const material of procedural.ownMaterials) {
        material.dispose();
      }
      disposeOwned(gltfMaterials);
      if (model === 'procedural') {
        disposeGeometries(procedural.group);
      } else {
        procedural.beacon.geometry.dispose();
      }
    },
  };
}

export function recolorPrimary(root: THREE.Object3D, hex: string): number {
  let count = 0;
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) {
      return;
    }
    const list = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of list) {
      if (!material || material.name !== PRIMARY_MATERIAL || !('color' in material)) {
        continue;
      }
      const color = material.color;
      if (color instanceof THREE.Color) {
        color.set(hex);
        count += 1;
      }
    }
  });
  return count;
}

export function findNamed(root: THREE.Object3D, name: string): THREE.Object3D | undefined {
  let found: THREE.Object3D | undefined;
  root.traverse((node) => {
    if (!found && node.name === name) {
      found = node;
    }
  });
  return found;
}

interface NamedNodes {
  Body?: THREE.Object3D;
  Head?: THREE.Object3D;
  ArmL?: THREE.Object3D;
  ArmR?: THREE.Object3D;
  LegL?: THREE.Object3D;
  LegR?: THREE.Object3D;
}

type GltfAvatar =
  | {
      kind: 'clip';
      model: THREE.Object3D;
      mixer: THREE.AnimationMixer;
      actions: Map<ClipName, THREE.AnimationAction>;
      current?: THREE.AnimationAction;
    }
  | { kind: 'nodes'; model: THREE.Object3D; nodes: NamedNodes; rig: AvatarRig }
  | { kind: 'static'; model: THREE.Object3D };

function findAvatarNodes(root: THREE.Object3D): NamedNodes | undefined {
  const nodes: NamedNodes = {};
  let found = false;
  for (const name of AVATAR_NODE_NAMES) {
    const node = findNamed(root, name);
    if (node) {
      nodes[name] = node;
      found = true;
    }
  }
  return found ? nodes : undefined;
}

function contractClips(animations: readonly THREE.AnimationClip[]): THREE.AnimationClip[] {
  return animations.filter((clip) => isClipName(clip.name));
}

function namedRig(model: THREE.Object3D, nodes: NamedNodes): AvatarRig {
  const folder = new THREE.Group();
  return {
    group: model as THREE.Group,
    pivot: (nodes.Body ?? model) as THREE.Group,
    head: (nodes.Head ?? new THREE.Group()) as THREE.Group,
    armL: (nodes.ArmL ?? new THREE.Group()) as THREE.Group,
    armR: (nodes.ArmR ?? new THREE.Group()) as THREE.Group,
    folder,
  };
}

function bindClips(model: THREE.Object3D, clips: readonly THREE.AnimationClip[]): GltfAvatar {
  const mixer = new THREE.AnimationMixer(model);
  const actions = new Map<ClipName, THREE.AnimationAction>();
  for (const clip of clips) {
    if (isClipName(clip.name)) {
      actions.set(clip.name, mixer.clipAction(clip));
    }
  }
  return { kind: 'clip', model, mixer, actions };
}

function playClip(
  binding: Extract<GltfAvatar, { kind: 'clip' }>,
  name: ClipName,
  dt: number,
  reduced: boolean,
): void {
  const action = binding.actions.get(name) ?? binding.actions.get('Idle');
  if (!action) {
    return;
  }
  if (binding.current !== action) {
    binding.current?.fadeOut(0.15);
    action.reset().fadeIn(0.15).play();
    binding.current = action;
  }
  if (reduced) {
    action.time = 0;
    binding.mixer.update(0);
    return;
  }
  binding.mixer.update(dt);
}

function poseLegs(nodes: NamedNodes, time: number, walking: boolean, reduced: boolean): void {
  const step = walking && !reduced ? Math.sin(time * 8) * 0.55 : 0;
  if (nodes.LegL) {
    nodes.LegL.rotation.x = step;
  }
  if (nodes.LegR) {
    nodes.LegR.rotation.x = -step;
  }
}

function adoptModel(scene: THREE.Object3D, owned: THREE.Material[]): THREE.Object3D {
  const copy = cloneSkinned(scene);
  copy.traverse((node) => {
    if (!(node instanceof THREE.Mesh) || !node.material) {
      return;
    }
    if (Array.isArray(node.material)) {
      node.material = node.material.map((material) => cloneMaterial(material, owned));
      return;
    }
    node.material = cloneMaterial(node.material, owned);
  });
  return copy;
}

function cloneMaterial(material: THREE.Material, owned: THREE.Material[]): THREE.Material {
  const copy = material.clone();
  owned.push(copy);
  return copy;
}

function fitHeight(object: THREE.Object3D, target: number): void {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  if (size.y < 0.001) {
    return;
  }
  object.scale.multiplyScalar(target / size.y);
  object.updateMatrixWorld(true);
  const grounded = new THREE.Box3().setFromObject(object);
  object.position.y -= grounded.min.y;
}

function fitWidth(object: THREE.Object3D, target: number): void {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const width = Math.max(size.x, size.z);
  if (width < 0.001) {
    return;
  }
  object.scale.multiplyScalar(target / width);
  object.updateMatrixWorld(true);
  const grounded = new THREE.Box3().setFromObject(object);
  object.position.y -= grounded.min.y;
}

function measureFace(screen: THREE.Object3D): { width: number; height: number; forward: number } {
  screen.updateMatrixWorld(true);
  if (screen instanceof THREE.Mesh && screen.geometry) {
    screen.geometry.computeBoundingBox();
    const box = screen.geometry.boundingBox;
    if (box) {
      const size = box.getSize(new THREE.Vector3());
      const world = new THREE.Vector3();
      screen.getWorldScale(world);
      const width = Math.abs(size.x * world.x);
      const height = Math.abs(size.y * world.y);
      const forward = Math.abs(size.z) * 0.5 + 0.02;
      if (width > 0.01 && height > 0.01) {
        return { width, height, forward };
      }
    }
  }
  return { width: SCREEN_WORLD_WIDTH, height: SCREEN_WORLD_HEIGHT, forward: 0.02 };
}

function disposeGeometries(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      geometries.add(node.geometry);
    }
  });
  for (const geometry of geometries) {
    geometry.dispose();
  }
}

function disposeOwned(materials: THREE.Material[]): void {
  for (const material of materials) {
    material.dispose();
  }
}
