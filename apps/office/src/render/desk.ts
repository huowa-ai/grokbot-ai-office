import * as THREE from 'three';

import type { AgentStatus } from '../scene/events.js';
import type { ResolvedStyle } from '../styles/agents.js';
import { beaconMaterial, lambert, paint } from './materials.js';
import { SCREEN_WORLD_HEIGHT, SCREEN_WORLD_WIDTH } from './screen.js';

export interface DeskRig {
  group: THREE.Group;
  screenAnchor: THREE.Object3D;
  beacon: THREE.Mesh;
  beaconMat: THREE.MeshLambertMaterial;
  ownMaterials: THREE.Material[];
}

const BEACON: Record<AgentStatus, string> = {
  working: '#f0b429',
  stuck: '#e23d3d',
  waiting_approval: '#3d7eff',
  handoff: '#3dae7a',
  idle: '#8d8478',
  unknown: '#8d8478',
};

export function buildDesk(style: ResolvedStyle): DeskRig {
  const group = new THREE.Group();
  const accent = style.hostAccent;
  const top = paint(new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.08, 0.82), lambert(accent.desk)));
  top.position.y = 0.74;
  const leg = (x: number, z: number): THREE.Mesh => {
    const mesh = paint(
      new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.08), lambert(accent.deskLeg)),
    );
    mesh.position.set(x, 0.35, z);
    return mesh;
  };
  group.add(top, leg(-0.68, -0.3), leg(0.68, -0.3), leg(-0.68, 0.3), leg(0.68, 0.3));

  const monitor = new THREE.Group();
  monitor.position.set(-0.18, 0.82, -0.08);
  monitor.rotation.x = -0.62;
  const bezel = paint(
    new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.56, 0.06), lambert(style.bezel)),
  );
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(SCREEN_WORLD_WIDTH, SCREEN_WORLD_HEIGHT, 0.02),
    lambert('#1c1917'),
  );
  glass.position.z = 0.04;
  const anchor = new THREE.Object3D();
  anchor.position.z = 0.02;
  glass.add(anchor);
  monitor.add(bezel, glass);
  group.add(monitor);

  const ownMaterials: THREE.Material[] = [];
  const beaconMat = beaconMaterial(BEACON.unknown);
  ownMaterials.push(beaconMat);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), beaconMat);
  beacon.position.set(0.62, 0.86, 0.28);
  beacon.castShadow = false;
  group.add(beacon);

  group.add(buildProp(style));
  if (accent.zone === 'local') {
    const pole = paint(
      new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.42, 6), lambert('#6e4324')),
    );
    pole.position.set(0.58, 0.98, -0.22);
    const bulbMaterial = new THREE.MeshLambertMaterial({
      color: accent.lamp,
      emissive: accent.lamp,
      emissiveIntensity: 0.7,
      flatShading: true,
    });
    ownMaterials.push(bulbMaterial);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), bulbMaterial);
    bulb.position.set(0.58, 1.22, -0.22);
    group.add(pole, bulb);
  }
  if (accent.zone === 'cloud') {
    const haloMaterial = new THREE.MeshLambertMaterial({
      color: accent.halo,
      emissive: accent.halo,
      emissiveIntensity: 0.55,
      flatShading: true,
    });
    ownMaterials.push(haloMaterial);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.035, 6, 14), haloMaterial);
    halo.rotation.x = Math.PI / 2;
    halo.position.set(0.55, 1.28, 0.15);
    group.add(halo);
  }

  const chair = paint(
    new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.42), lambert(accent.deskLeg)),
  );
  chair.position.set(0.78, 0.28, 0.12);
  const back = paint(
    new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.36, 0.06), lambert(accent.deskLeg)),
  );
  back.position.set(0.78, 0.46, -0.08);
  group.add(chair, back);

  return { group, screenAnchor: anchor, beacon, beaconMat, ownMaterials };
}

export function setBeacon(rig: DeskRig, status: AgentStatus, time: number, reduced: boolean): void {
  const color = BEACON[status];
  rig.beaconMat.color.set(color);
  rig.beaconMat.emissive.set(color);
  const pulse = status === 'stuck' && !reduced ? 0.45 + Math.sin(time * 6) * 0.4 : 0.4;
  rig.beaconMat.emissiveIntensity = status === 'idle' || status === 'unknown' ? 0.08 : pulse;
}

function buildProp(style: ResolvedStyle): THREE.Object3D {
  const group = new THREE.Group();
  const color = style.palette.accent;
  const secondary = style.palette.secondary;
  switch (style.deskProp) {
    case 'keyboard': {
      group.add(placed(0.46, 0.04, 0.16, '#2a2826', 0.05, 0.8, 0.18));
      break;
    }
    case 'books': {
      group.add(placed(0.16, 0.08, 0.22, color, -0.15, 0.82, 0.16));
      group.add(placed(0.16, 0.07, 0.22, secondary, -0.15, 0.89, 0.16));
      group.add(placed(0.05, 0.22, 0.18, style.palette.primary, 0.05, 0.88, 0.12));
      break;
    }
    case 'stars': {
      const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.08, 0), lambert(color));
      star.position.set(0.1, 0.9, 0.16);
      const star2 = star.clone();
      star2.position.x = 0.28;
      star2.scale.setScalar(0.7);
      group.add(star, star2);
      break;
    }
    case 'plant': {
      const pot = placed(0.14, 0.12, 0.14, '#c47b4a', 0.15, 0.84, 0.12);
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), lambert('#2f9e6b'));
      leaf.position.set(0.15, 1.02, 0.12);
      group.add(pot, leaf);
      break;
    }
    case 'satchel':
      group.add(placed(0.22, 0.16, 0.1, color, 0.12, 0.88, 0.14));
      break;
    case 'shell': {
      const shell = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), lambert(secondary));
      shell.scale.set(1.2, 0.7, 1);
      shell.position.set(0.12, 0.86, 0.16);
      group.add(shell);
      break;
    }
    case 'wave':
      group.add(placed(0.28, 0.04, 0.08, color, 0.02, 0.8, 0.18));
      group.add(placed(0.2, 0.04, 0.08, secondary, 0.08, 0.84, 0.22));
      break;
    default:
      group.add(placed(0.1, 0.12, 0.1, secondary, 0.16, 0.86, 0.16));
      break;
  }
  return group;
}

function placed(
  width: number,
  height: number,
  depth: number,
  color: string,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const mesh = paint(new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), lambert(color)));
  mesh.position.set(x, y, z);
  return mesh;
}
