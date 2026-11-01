import * as THREE from 'three';

import type { AgentStatus } from '../scene/events.js';
import type { ResolvedStyle } from '../styles/agents.js';
import { lambert, paint } from './materials.js';

export interface AvatarRig {
  group: THREE.Group;
  pivot: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  folder: THREE.Group;
  sparkles?: THREE.Group;
  antenna?: THREE.Group;
}

export function createCarryProp(accent = '#c4843c'): THREE.Group {
  const folder = new THREE.Group();
  const file = paint(new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.34, 0.06), lambert('#f4e2b8')));
  const tab = paint(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.07), lambert(accent)));
  tab.position.set(0.06, 0.18, 0);
  folder.add(file, tab);
  folder.position.set(0, 0.48, 0.32);
  folder.visible = false;
  return folder;
}

export function buildAvatar(style: ResolvedStyle): AvatarRig {
  const group = new THREE.Group();
  const pivot = new THREE.Group();
  group.add(pivot);
  const primary = style.palette.primary;
  const secondary = style.palette.secondary;
  const accent = style.palette.accent;
  const head = new THREE.Group();
  const armL = limb(secondary, 0.11, 0.36);
  const armR = limb(secondary, 0.11, 0.36);
  armL.position.set(-0.28, 0.72, 0);
  armR.position.set(0.28, 0.72, 0);

  switch (style.body) {
    case 'robot':
      buildRobot(pivot, head, primary, secondary, accent);
      break;
    case 'round':
      buildRound(pivot, head, primary, secondary, accent);
      break;
    case 'twin':
      buildTwin(pivot, head, primary, accent, secondary);
      break;
    case 'headset':
      buildHeadset(pivot, head, primary, secondary, accent);
      break;
    case 'messenger':
      buildMessenger(pivot, head, primary, secondary, accent);
      break;
    case 'lobster':
      buildLobster(pivot, head, armL, armR, primary, secondary, accent);
      break;
    case 'whale':
      buildWhale(pivot, head, armL, armR, primary, secondary, accent);
      break;
    default:
      buildBlob(pivot, head, primary, secondary, accent);
      break;
  }

  if (style.body !== 'lobster' && style.body !== 'whale') {
    pivot.add(armL, armR);
  }
  addAccessory(pivot, head, style, secondary, accent);
  pivot.add(head);

  const folder = createCarryProp(accent);
  pivot.add(folder);

  const rig: AvatarRig = { group, pivot, head, armL, armR, folder };
  claimAnimated(rig);
  return rig;
}

export function poseAvatar(
  rig: AvatarRig,
  style: ResolvedStyle,
  status: AgentStatus,
  time: number,
  walking: boolean,
  reduced: boolean,
): void {
  const amp = reduced ? 0 : 1;
  rig.pivot.rotation.set(0, 0, 0);
  rig.pivot.position.y = 0;
  rig.head.rotation.set(0, 0, 0);
  rig.armL.rotation.set(0, 0, 0);
  rig.armR.rotation.set(0, 0, 0);
  rig.folder.visible = walking;
  if (rig.sparkles) {
    rig.sparkles.rotation.y = reduced ? 0.4 : time * (status === 'working' ? 2.4 : 0.6);
  }
  if (rig.antenna) {
    rig.antenna.rotation.z = Math.sin(time * 3) * 0.12 * amp;
  }

  if (walking) {
    const step = Math.sin(time * 8) * 0.55 * amp;
    rig.armL.rotation.x = step;
    rig.armR.rotation.x = -step;
    rig.pivot.position.y = Math.abs(Math.sin(time * 8)) * 0.06 * amp;
    rig.folder.rotation.z = Math.sin(time * 4) * 0.1 * amp;
    return;
  }

  if (status === 'waiting_approval') {
    rig.armR.rotation.x = -2.5;
    rig.armL.rotation.x = 0.35;
    rig.head.rotation.z = -0.15;
    return;
  }

  if (status === 'stuck') {
    rig.armL.rotation.x = 0.15;
    rig.armR.rotation.x = 0.15;
    rig.head.rotation.z = reduced ? 0.2 : 0.12 + Math.sin(time * 8) * 0.08;
    return;
  }

  if (status === 'working') {
    poseTyping(rig, style.typing, time, amp);
    return;
  }

  if (status === 'idle') {
    rig.head.rotation.x = 0.45;
    rig.armL.rotation.x = 0.2;
    rig.armR.rotation.x = 0.2;
    poseIdle(rig, style.idlePose, time, amp);
    return;
  }

  rig.armL.rotation.x = 0.35;
  rig.armR.rotation.x = 0.35;
}

function poseTyping(
  rig: AvatarRig,
  flavor: ResolvedStyle['typing'],
  time: number,
  amp: number,
): void {
  const speed = flavor === 'clack' || flavor === 'claws' ? 12 : 8;
  const wave = 0.55 + Math.sin(time * speed) * 0.38 * amp;
  const wave2 = 0.55 + Math.sin(time * speed + 1.2) * 0.38 * amp;
  rig.armL.rotation.x = wave;
  rig.armR.rotation.x = wave2;
  if (flavor === 'nod') {
    rig.head.rotation.x = Math.sin(time * 4) * 0.2 * amp;
  }
  if (flavor === 'claws') {
    rig.armL.rotation.z = 0.4 + Math.sin(time * speed) * 0.35 * amp;
    rig.armR.rotation.z = -0.4 - Math.sin(time * speed) * 0.35 * amp;
  }
  if (flavor === 'wings') {
    rig.armL.rotation.z = 0.5 + Math.sin(time * 10) * 0.3 * amp;
    rig.armR.rotation.z = -0.5 - Math.sin(time * 10) * 0.3 * amp;
  }
  if (flavor === 'tail') {
    rig.pivot.rotation.y = Math.sin(time * 3) * 0.18 * amp;
  }
  if (flavor === 'flip') {
    rig.head.rotation.z = Math.sin(time * 3) * 0.15 * amp;
  }
}

function poseIdle(
  rig: AvatarRig,
  pose: ResolvedStyle['idlePose'],
  time: number,
  amp: number,
): void {
  if (pose === 'sway' || pose === 'sleep') {
    rig.pivot.rotation.z = Math.sin(time * 1.4) * 0.08 * amp;
  }
  if (pose === 'hover') {
    rig.pivot.position.y = 0.04 + Math.sin(time * 2) * 0.04 * amp;
  }
  if (pose === 'bob') {
    rig.pivot.position.y = Math.abs(Math.sin(time * 2)) * 0.05 * amp;
  }
  if (pose === 'perch') {
    rig.head.rotation.x = 0.2;
    rig.pivot.rotation.x = -0.08;
  }
}

function buildRobot(
  pivot: THREE.Group,
  head: THREE.Group,
  primary: string,
  secondary: string,
  accent: string,
): void {
  pivot.add(paint(box(0.46, 0.5, 0.3, primary, 0, 0.48, 0)));
  pivot.add(paint(box(0.12, 0.28, 0.12, accent, -0.12, 0.14, 0)));
  pivot.add(paint(box(0.12, 0.28, 0.12, accent, 0.12, 0.14, 0)));
  head.add(paint(box(0.38, 0.3, 0.3, primary, 0, 0, 0)));
  head.add(paint(box(0.26, 0.08, 0.04, secondary, 0, 0.02, 0.16)));
  head.position.set(0, 0.9, 0);
  const antenna = new THREE.Group();
  antenna.add(
    paint(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.22, 6), lambert(accent))),
  );
  const ball = paint(new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), lambert(secondary)));
  ball.position.y = 0.16;
  antenna.add(ball);
  antenna.position.set(0, 0.2, 0);
  head.add(antenna);
  (head.userData as { antenna?: THREE.Group }).antenna = antenna;
}

function buildRound(
  pivot: THREE.Group,
  head: THREE.Group,
  primary: string,
  secondary: string,
  accent: string,
): void {
  const body = paint(new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 8), lambert(primary)));
  body.position.y = 0.42;
  body.scale.y = 0.92;
  pivot.add(body);
  const skull = paint(new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), lambert(secondary)));
  head.add(skull);
  eyes(head, 0.02, 0.18, 0.08);
  const scarf = paint(new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.045, 6, 10), lambert(accent)));
  scarf.rotation.x = Math.PI / 2;
  scarf.position.y = -0.16;
  head.add(scarf);
  const tail = paint(box(0.08, 0.2, 0.06, accent, 0.12, -0.28, 0.02));
  head.add(tail);
  head.position.set(0, 0.86, 0);
}

function buildTwin(
  pivot: THREE.Group,
  head: THREE.Group,
  primary: string,
  accent: string,
  secondary: string,
): void {
  pivot.add(paint(box(0.24, 0.5, 0.32, primary, -0.12, 0.46, 0)));
  pivot.add(paint(box(0.24, 0.5, 0.32, accent, 0.12, 0.46, 0)));
  const skull = paint(new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), lambert(secondary)));
  head.add(skull);
  eyes(head, 0.02, 0.18, 0.08);
  head.position.set(0, 0.9, 0);
  const sparkles = new THREE.Group();
  for (const [x, y, z] of [
    [-0.28, 0.2, 0.1],
    [0.3, 0.05, 0.05],
    [0.02, 0.32, -0.08],
  ] as const) {
    const star = paint(
      new THREE.Mesh(new THREE.OctahedronGeometry(0.07, 0), lambert(x < 0 ? primary : accent)),
      false,
    );
    star.position.set(x, y, z);
    sparkles.add(star);
  }
  head.add(sparkles);
  (head.userData as { sparkles?: THREE.Group }).sparkles = sparkles;
}

function buildHeadset(
  pivot: THREE.Group,
  head: THREE.Group,
  primary: string,
  secondary: string,
  accent: string,
): void {
  const body = paint(new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 8), lambert(primary)));
  body.position.y = 0.42;
  pivot.add(body);
  const skull = paint(new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), lambert(secondary)));
  head.add(skull);
  eyes(head, 0.02, 0.18, 0.08);
  const band = paint(new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 6, 12), lambert(accent)));
  band.rotation.z = Math.PI / 2;
  head.add(band);
  head.add(paint(box(0.09, 0.12, 0.1, accent, -0.2, 0, 0.02)));
  head.add(paint(box(0.09, 0.12, 0.1, accent, 0.2, 0, 0.02)));
  const mic = paint(box(0.04, 0.16, 0.04, accent, 0.16, -0.12, 0.16));
  head.add(mic);
  head.position.set(0, 0.88, 0);
}

function buildMessenger(
  pivot: THREE.Group,
  head: THREE.Group,
  primary: string,
  secondary: string,
  accent: string,
): void {
  pivot.add(paint(box(0.32, 0.46, 0.22, secondary, 0, 0.5, 0)));
  pivot.add(paint(box(0.34, 0.16, 0.24, primary, 0, 0.28, 0)));
  pivot.add(paint(box(0.1, 0.32, 0.1, accent, -0.1, 0.16, 0)));
  pivot.add(paint(box(0.1, 0.32, 0.1, accent, 0.1, 0.16, 0)));
  const skull = paint(new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), lambert(secondary)));
  head.add(skull);
  eyes(head, 0.02, 0.14, 0.07);
  head.position.set(0, 0.92, 0);
  const wingL = wing(primary);
  const wingR = wing(primary);
  wingL.position.set(-0.12, 0.08, 0.04);
  wingR.position.set(0.12, 0.08, 0.04);
  wingR.scale.x = -1;
  pivot.add(wingL, wingR);
  const satchel = paint(box(0.18, 0.16, 0.08, accent, 0.24, 0.42, 0.02));
  pivot.add(satchel);
}

function buildLobster(
  pivot: THREE.Group,
  head: THREE.Group,
  armL: THREE.Group,
  armR: THREE.Group,
  primary: string,
  secondary: string,
  accent: string,
): void {
  const body = paint(new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), lambert(primary)));
  body.scale.set(1.35, 0.72, 0.9);
  body.position.set(0, 0.36, 0);
  pivot.add(body);
  const tail = paint(box(0.2, 0.08, 0.28, accent, 0, 0.28, -0.32));
  pivot.add(tail);
  armL.clear();
  armR.clear();
  armL.add(claw(primary, secondary));
  armR.add(claw(primary, secondary));
  armL.position.set(-0.42, 0.42, 0.12);
  armR.position.set(0.42, 0.42, 0.12);
  pivot.add(armL, armR);
  const stalkL = paint(
    new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 5), lambert(accent)),
  );
  const stalkR = stalkL.clone();
  stalkL.position.set(-0.08, 0.12, 0.06);
  stalkR.position.set(0.08, 0.12, 0.06);
  head.add(stalkL, stalkR);
  const eyeL = paint(
    new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), lambert('#1c1917')),
    false,
  );
  const eyeR = eyeL.clone();
  eyeL.position.set(-0.08, 0.2, 0.06);
  eyeR.position.set(0.08, 0.2, 0.06);
  head.add(eyeL, eyeR);
  head.position.set(0, 0.52, 0.2);
}

function buildWhale(
  pivot: THREE.Group,
  head: THREE.Group,
  armL: THREE.Group,
  armR: THREE.Group,
  primary: string,
  secondary: string,
  accent: string,
): void {
  const body = paint(new THREE.Mesh(new THREE.SphereGeometry(0.36, 12, 8), lambert(primary)));
  body.scale.set(1.15, 0.78, 1.45);
  body.position.y = 0.38;
  pivot.add(body);
  const belly = paint(box(0.28, 0.1, 0.4, secondary, 0, 0.18, 0.05));
  pivot.add(belly);
  const fluke = paint(box(0.36, 0.06, 0.16, accent, 0, 0.4, -0.5));
  pivot.add(fluke);
  armL.clear();
  armR.clear();
  armL.add(paint(box(0.2, 0.06, 0.12, accent, 0, -0.04, 0)));
  armR.add(paint(box(0.2, 0.06, 0.12, accent, 0, -0.04, 0)));
  armL.position.set(-0.4, 0.36, 0.05);
  armR.position.set(0.4, 0.36, 0.05);
  pivot.add(armL, armR);
  eyes(head, 0, 0.1, 0.12, '#f4f0ea');
  const spout = new THREE.Group();
  const puff = paint(
    new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), lambert(secondary)),
    false,
  );
  puff.position.y = 0.12;
  spout.add(puff);
  spout.position.set(0, 0.16, 0.05);
  head.add(spout);
  head.position.set(0, 0.62, 0.28);
  (head.userData as { antenna?: THREE.Group }).antenna = spout;
}

function buildBlob(
  pivot: THREE.Group,
  head: THREE.Group,
  primary: string,
  secondary: string,
  accent: string,
): void {
  const body = paint(new THREE.Mesh(new THREE.SphereGeometry(0.36, 10, 8), lambert(primary)));
  body.position.y = 0.4;
  body.scale.y = 0.85;
  pivot.add(body);
  const skull = paint(new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), lambert(secondary)));
  head.add(skull);
  eyes(head, 0.02, 0.16, 0.07);
  const cap = paint(
    new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.1, 8), lambert(accent)),
  );
  cap.position.y = 0.16;
  head.add(cap);
  head.position.set(0, 0.82, 0);
}

function addAccessory(
  pivot: THREE.Group,
  head: THREE.Group,
  style: ResolvedStyle,
  secondary: string,
  accent: string,
): void {
  if (style.accessory === 'scarf' && style.body !== 'round') {
    const scarf = paint(new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.04, 6, 8), lambert(accent)));
    scarf.rotation.x = Math.PI / 2;
    scarf.position.y = 0.7;
    pivot.add(scarf);
  }
  if (style.accessory === 'headset' && style.body !== 'headset') {
    const band = paint(new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.03, 6, 10), lambert(accent)));
    band.position.y = 0.9;
    pivot.add(band);
  }
  if (style.accessory === 'none') {
    const hat = paint(new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.16, 6), lambert(secondary)));
    hat.position.y = 0.18;
    head.add(hat);
  }
}

export function claimAnimated(rig: AvatarRig): void {
  const headData = rig.head.userData as { sparkles?: THREE.Group; antenna?: THREE.Group };
  if (headData.sparkles) {
    rig.sparkles = headData.sparkles;
  }
  if (headData.antenna) {
    rig.antenna = headData.antenna;
  }
}

function limb(color: string, width: number, length: number): THREE.Group {
  const group = new THREE.Group();
  const mesh = paint(new THREE.Mesh(new THREE.BoxGeometry(width, length, width), lambert(color)));
  mesh.geometry.translate(0, -length / 2, 0);
  group.add(mesh);
  return group;
}

function claw(primary: string, secondary: string): THREE.Group {
  const group = new THREE.Group();
  group.add(paint(box(0.22, 0.1, 0.16, primary, 0, -0.08, 0.08)));
  group.add(paint(box(0.16, 0.06, 0.12, secondary, 0, -0.02, 0.16)));
  return group;
}

function wing(color: string): THREE.Group {
  const group = new THREE.Group();
  const mesh = paint(new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 4), lambert(color)), false);
  mesh.rotation.z = Math.PI / 2;
  mesh.position.x = -0.12;
  group.add(mesh);
  return group;
}

function box(
  width: number,
  height: number,
  depth: number,
  color: string,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), lambert(color));
  mesh.position.set(x, y, z);
  return mesh;
}

function eyes(
  parent: THREE.Object3D,
  y: number,
  z: number,
  spread: number,
  color = '#1c1917',
): void {
  for (const side of [-1, 1]) {
    const eye = paint(new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), lambert(color)), false);
    eye.position.set(side * spread, y, z);
    parent.add(eye);
  }
}
