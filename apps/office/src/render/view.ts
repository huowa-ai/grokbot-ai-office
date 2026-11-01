import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';

import { statusLabel } from '../scene/labels.js';
import {
  endpointForInstance,
  seatPosition,
  slotPlacement,
  walkPosition,
  yawToward,
} from '../scene/layout.js';
import type { Vec3 } from '../scene/layout.js';
import { type NameMap, friendlyName } from '../scene/names.js';
import type { SceneAgent, SceneState } from '../scene/state.js';
import { listAgents } from '../scene/state.js';
import { chooseTerminals } from '../scene/terminal-pool.js';
import { type ResolvedStyle, type StyleCatalog, resolveAgentStyle } from '../styles/agents.js';
import {
  type AvatarMount,
  type DeskMount,
  createModelLibrary,
  mountAvatar,
  mountDesk,
} from './avatar-factory.js';
import { createCameraRig, createFocusController, createIsometricController } from './cameras.js';
import { setBeacon } from './desk.js';
import { buildRoom } from './room.js';
import { type ScreenSnapshot, createTerminalPool } from './terminals.js';

interface Station {
  key: string;
  desk: DeskMount;
  avatar: AvatarMount;
  tag: CSS2DObject;
  bubble: CSS2DObject;
  who: HTMLElement;
  state: HTMLElement;
  bubbleBody: HTMLElement;
}

export interface OfficeView {
  frame(
    state: SceneState,
    catalog: StyleCatalog,
    names: NameMap,
    dt: number,
    reduced: boolean,
  ): void;
  setFocus(instance: string | undefined): void;
  pick(clientX: number, clientY: number): string | undefined;
  resize(): void;
  dispose(): void;
}

export function createOfficeView(container: HTMLElement): OfficeView {
  const stage = document.createElement('div');
  stage.className = 'stage';
  container.prepend(stage);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f4e7d6');
  const cssScene = new THREE.Scene();
  const labelScene = new THREE.Scene();
  scene.add(buildRoom());
  addZoneLabels(labelScene);
  addBossLabel(labelScene);

  const hemi = new THREE.HemisphereLight('#fff6ea', '#d9b894', 0.95);
  const sun = new THREE.DirectionalLight('#fff8ef', 1.2);
  sun.position.set(7, 16, 9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -14;
  sun.shadow.camera.right = 14;
  sun.shadow.camera.top = 14;
  sun.shadow.camera.bottom = -14;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 40;
  sun.shadow.bias = -0.0004;
  scene.add(hemi, sun);

  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 80);
  const overview = createIsometricController();
  let focusId: string | undefined;
  const focusPoint = new THREE.Vector3();
  const rig = createCameraRig(
    camera,
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  rig.use(overview, true);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  stage.append(renderer.domElement);

  const css3d = new CSS3DRenderer();
  css3d.domElement.className = 'css3d';
  stage.append(css3d.domElement);
  const css2d = new CSS2DRenderer();
  css2d.domElement.className = 'css2d';
  stage.append(css2d.domElement);

  const terminals = createTerminalPool(cssScene);
  const models = createModelLibrary();
  const stations = new Map<string, Station>();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const ndc = new THREE.Vector3();
  const clockSeats = new Map<string, Vec3>();

  const resize = (): void => {
    const width = stage.clientWidth || window.innerWidth;
    const height = stage.clientHeight || window.innerHeight;
    const aspect = width / Math.max(1, height);
    const frustum = 8.6;
    camera.left = -frustum * aspect;
    camera.right = frustum * aspect;
    camera.top = frustum;
    camera.bottom = -frustum;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    css3d.setSize(width, height);
    css2d.setSize(width, height);
  };
  resize();

  return {
    frame(state, catalog, names, dt, reduced) {
      const agents = listAgents(state);
      const seen = new Set<string>();
      clockSeats.clear();
      for (const agent of agents) {
        clockSeats.set(agent.instance, seatPosition(agent.zone, agent.slot));
      }
      for (const agent of agents) {
        seen.add(agent.instance);
        const style = resolveAgentStyle(agent.provider, agent.host, catalog);
        const key = styleKey(style);
        let station = stations.get(agent.instance);
        if (!station || station.key !== key) {
          if (station) {
            removeStation(scene, labelScene, station);
          }
          station = createStation(scene, labelScene, agent.instance, style, models);
          stations.set(agent.instance, station);
        }
        placeStation(station, agent, names, clockSeats, reduced, performance.now() / 1000, dt);
      }
      for (const [id, station] of stations) {
        if (!seen.has(id)) {
          removeStation(scene, labelScene, station);
          stations.delete(id);
        }
      }
      if (focusId && !seen.has(focusId)) {
        focusId = undefined;
        rig.use(overview, reduced);
      }
      rig.update(dt, reduced);

      const anchors = new Map<string, THREE.Object3D>();
      const screens = new Map<string, ScreenSnapshot>();
      const candidates = agents.map((agent) => {
        const station = stations.get(agent.instance);
        const seat = clockSeats.get(agent.instance);
        if (station) {
          anchors.set(agent.instance, station.desk.screenAnchor);
        }
        screens.set(agent.instance, {
          text: agent.screen,
          epoch: agent.screenEpoch,
          fit: agent.fit,
          focused: agent.instance === focusId,
          width: station?.desk.screenSize.width ?? 0,
          height: station?.desk.screenSize.height ?? 0,
        });
        if (!seat) {
          return { instance: agent.instance, visible: false };
        }
        ndc.set(seat.x, 1, seat.z).project(camera);
        const visible = ndc.z < 1 && Math.abs(ndc.x) <= 1.15 && Math.abs(ndc.y) <= 1.15;
        return { instance: agent.instance, visible };
      });
      const hidden = document.visibilityState === 'hidden';
      if (!hidden) {
        terminals.sync(chooseTerminals(candidates, focusId), anchors, screens);
        renderer.render(scene, camera);
        css3d.render(cssScene, camera);
        css2d.render(labelScene, camera);
      }
    },
    setFocus(instance) {
      focusId = instance;
      rig.use(instance ? rigFocus() : overview, false);
    },
    pick(clientX, clientY) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      for (const hit of hits) {
        const id = instanceOf(hit.object);
        if (id) {
          return id;
        }
      }
      return undefined;
    },
    resize,
    dispose() {
      terminals.dispose();
      for (const station of stations.values()) {
        removeStation(scene, labelScene, station);
      }
      stations.clear();
      renderer.dispose();
      stage.remove();
    },
  };

  function rigFocus() {
    return createFocusController(overview, () => {
      if (!focusId) {
        return undefined;
      }
      const station = stations.get(focusId);
      if (!station) {
        return undefined;
      }
      station.desk.screenAnchor.getWorldPosition(focusPoint);
      return [focusPoint.x, focusPoint.y, focusPoint.z];
    });
  }
}

function createStation(
  scene: THREE.Scene,
  labelScene: THREE.Scene,
  instance: string,
  style: ResolvedStyle,
  models: ReturnType<typeof createModelLibrary>,
): Station {
  const desk = mountDesk(style, models);
  const avatar = mountAvatar(style, models);
  tagInstance(desk.group, instance);
  tagInstance(avatar.group, instance);
  scene.add(desk.group, avatar.group);

  const tagEl = document.createElement('div');
  tagEl.className = `tag ${style.hostAccent.zone}`;
  tagEl.style.borderColor = style.nameTag;
  const who = document.createElement('strong');
  const state = document.createElement('span');
  tagEl.append(who, state);
  const tag = new CSS2DObject(tagEl);

  const bubbleEl = document.createElement('div');
  bubbleEl.className = 'bubble';
  const bubbleBody = document.createElement('div');
  bubbleEl.append(bubbleBody);
  const bubble = new CSS2DObject(bubbleEl);
  labelScene.add(tag, bubble);
  return { key: styleKey(style), desk, avatar, tag, bubble, who, state, bubbleBody };
}

function placeStation(
  station: Station,
  agent: SceneAgent,
  names: NameMap,
  seats: ReadonlyMap<string, Vec3>,
  reduced: boolean,
  time: number,
  dt: number,
): void {
  const place = slotPlacement(agent.zone, agent.slot);
  const fit = Math.max(agent.fit, 0.04);
  station.desk.group.position.set(place.x, 0, place.z);
  station.desk.group.rotation.y = place.rotationY;
  station.desk.group.scale.setScalar(fit);
  setBeacon(station.desk, agent.status, time, reduced);

  const home = seats.get(agent.instance) ?? seatPosition(agent.zone, agent.slot);
  let pos = home;
  let face = { x: home.x + 0.2, y: 0, z: home.z + 2 };
  const walking = agent.handoff !== undefined;
  if (agent.handoff) {
    const end = endpointForInstance(agent.handoff.to, seats);
    pos = walkPosition(home, end, agent.handoff.phase, agent.handoff.progress);
    face =
      agent.handoff.phase === 'return'
        ? home
        : walkPosition(home, end, agent.handoff.phase, Math.min(1, agent.handoff.progress + 0.08));
  }
  station.avatar.group.position.set(pos.x, 0, pos.z);
  station.avatar.group.rotation.y = yawToward(pos, face);
  station.avatar.group.scale.setScalar(fit);
  station.avatar.pose(agent.status, time, dt, walking, reduced);

  station.who.textContent = friendlyName(agent.provider, agent.host, names);
  station.state.textContent = statusLabel(agent.status);
  const bubble = bubbleText(agent);
  station.bubbleBody.textContent = bubble?.text ?? '';
  station.bubble.element.className = `bubble ${bubble?.kind ?? 'hidden'}`;
  station.tag.position.set(pos.x, 1.38 * fit, pos.z);
  station.bubble.position.set(pos.x, 1.72 * fit, pos.z);
}

function bubbleText(agent: SceneAgent): { text: string; kind: string } | undefined {
  if (agent.handoff) {
    const name = agent.handoff.filePath.split('/').pop() ?? '文件';
    return { text: name, kind: 'carry' };
  }
  if (agent.status === 'stuck' && agent.stuck) {
    const code = agent.stuck.code ? `${agent.stuck.code} ` : '';
    return { text: `${code}${agent.stuck.reason}`, kind: 'bad' };
  }
  if (agent.status === 'waiting_approval' && agent.approval) {
    return { text: `待批准 ${agent.approval.summary}`, kind: 'wait' };
  }
  if (agent.status === 'idle') {
    return { text: 'Zzz', kind: 'zzz' };
  }
  return undefined;
}

function removeStation(scene: THREE.Scene, labelScene: THREE.Scene, station: Station): void {
  scene.remove(station.desk.group, station.avatar.group);
  labelScene.remove(station.tag, station.bubble);
  station.tag.element.remove();
  station.bubble.element.remove();
  station.avatar.dispose();
  station.desk.dispose();
}

function tagInstance(object: THREE.Object3D, instance: string): void {
  object.userData.instance = instance;
  object.traverse((child) => {
    child.userData.instance = instance;
  });
}

function instanceOf(object: THREE.Object3D): string | undefined {
  let current: THREE.Object3D | null = object;
  while (current) {
    const id = current.userData.instance;
    if (typeof id === 'string') {
      return id;
    }
    current = current.parent;
  }
  return undefined;
}

function styleKey(style: ResolvedStyle): string {
  return [
    style.body,
    style.palette.primary,
    style.palette.secondary,
    style.palette.accent,
    style.accessory,
    style.deskProp,
    style.bezel,
    style.nameTag,
    style.idlePose,
    style.typing,
    style.hostAccent.zone,
    style.hostAccent.desk,
  ].join('|');
}

function addZoneLabels(labelScene: THREE.Scene): void {
  labelScene.add(zoneLabel('本地', -5.7, -0.2));
  labelScene.add(zoneLabel('云端', 5.7, -0.2));
}

function addBossLabel(labelScene: THREE.Scene): void {
  const element = document.createElement('div');
  element.className = 'zone-label boss-label';
  element.textContent = '老板';
  const label = new CSS2DObject(element);
  label.position.set(0, 1.5, 6.2);
  labelScene.add(label);
}

function zoneLabel(text: string, x: number, z: number): CSS2DObject {
  const element = document.createElement('div');
  element.className = 'zone-label';
  element.textContent = text;
  const label = new CSS2DObject(element);
  label.position.set(x, 2.15, z - 3.6);
  return label;
}
