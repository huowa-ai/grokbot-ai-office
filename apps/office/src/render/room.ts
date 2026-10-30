import * as THREE from 'three';

import { BOSS_DESK } from '../scene/layout.js';
import { lambert, paint } from './materials.js';

export function buildRoom(): THREE.Group {
  const room = new THREE.Group();
  const floor = paint(
    new THREE.Mesh(new THREE.BoxGeometry(22, 0.3, 18), lambert('#e7d3b8')),
    false,
  );
  floor.position.y = -0.15;
  floor.receiveShadow = true;
  floor.castShadow = false;
  room.add(floor);

  const localRug = paint(
    new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.04, 8.4), lambert('#efc89a')),
    false,
  );
  localRug.position.set(-5.7, 0.02, -1.4);
  localRug.castShadow = false;
  const cloudRug = paint(
    new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.04, 8.4), lambert('#d5e6f4')),
    false,
  );
  cloudRug.position.set(5.7, 0.02, -1.4);
  cloudRug.castShadow = false;
  room.add(localRug, cloudRug);

  const wallColor = '#f6eee4';
  const back = paint(new THREE.Mesh(new THREE.BoxGeometry(22, 3.2, 0.2), lambert(wallColor)));
  back.position.set(0, 1.6, -8.6);
  const left = paint(new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.2, 16), lambert(wallColor)));
  left.position.set(-11, 1.6, -0.6);
  const right = left.clone();
  right.position.x = 11;
  room.add(back, left, right);

  for (const x of [-7.2, -3.2, 3.2, 7.2]) {
    const frame = paint(new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.3, 0.08), lambert('#cbb39a')));
    frame.position.set(x, 1.8, -8.46);
    const pane = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 1, 0.04),
      new THREE.MeshLambertMaterial({
        color: '#c5dff5',
        emissive: '#9ec8ea',
        emissiveIntensity: 0.25,
        flatShading: true,
      }),
    );
    pane.position.set(x, 1.8, -8.4);
    room.add(frame, pane);
  }

  room.add(buildBossDesk());
  const plant = plantCluster();
  plant.position.set(-9.4, 0, 4.2);
  room.add(plant);
  return room;
}

function buildBossDesk(): THREE.Group {
  const group = new THREE.Group();
  group.position.set(BOSS_DESK.x, 0, BOSS_DESK.z);
  group.userData.placeholder = 'boss';
  const top = paint(new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 1.1), lambert('#8d5a32')));
  top.position.y = 0.78;
  const leg = paint(new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.7, 0.9), lambert('#6b4124')));
  leg.position.y = 0.35;
  const monitor = paint(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.46, 0.06), lambert('#3a312c')));
  monitor.position.set(0, 1.15, -0.28);
  monitor.rotation.x = -0.4;
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.34, 0.02), lambert('#241c19'));
  glass.position.set(0, 1.15, -0.24);
  glass.rotation.x = -0.4;
  const chair = paint(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), lambert('#5c4638')));
  chair.position.set(0, 0.28, 0.7);
  group.add(top, leg, monitor, glass, chair);
  return group;
}

function plantCluster(): THREE.Group {
  const group = new THREE.Group();
  const pot = paint(
    new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.14, 0.22, 7), lambert('#c47b4a')),
  );
  pot.position.y = 0.11;
  const leaf = paint(new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), lambert('#3e8f55')));
  leaf.position.y = 0.4;
  group.add(pot, leaf);
  return group;
}
