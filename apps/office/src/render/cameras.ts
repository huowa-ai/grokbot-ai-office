import * as THREE from 'three';

import { FOCUS_ZOOM, ISO_OFFSET, ISO_TARGET, OVERVIEW_ZOOM } from './screen.js';

export interface CameraSample {
  position: [number, number, number];
  target: [number, number, number];
  zoom: number;
}

export interface CameraController {
  readonly id: 'isometric' | 'focus';
  sample(): CameraSample;
}

/** Step 5 reserves this id for a perspective WASD camera. It is not started. */
export const BOSS_VIEW_ID = 'boss' as const;

export interface BossViewPlaceholder {
  id: typeof BOSS_VIEW_ID;
  implemented: false;
  controls: 'wasd+mouse';
}

export function createBossViewPlaceholder(): BossViewPlaceholder {
  return { id: BOSS_VIEW_ID, implemented: false, controls: 'wasd+mouse' };
}

export function isometricSample(
  target: [number, number, number] = ISO_TARGET,
  zoom = OVERVIEW_ZOOM,
): CameraSample {
  return {
    position: [target[0] + ISO_OFFSET[0], target[1] + ISO_OFFSET[1], target[2] + ISO_OFFSET[2]],
    target,
    zoom,
  };
}

export function focusSample(overview: CameraSample, point: [number, number, number]): CameraSample {
  return {
    position: [
      point[0] + (overview.position[0] - overview.target[0]),
      point[1] + (overview.position[1] - overview.target[1]),
      point[2] + (overview.position[2] - overview.target[2]),
    ],
    target: point,
    zoom: FOCUS_ZOOM,
  };
}

export function createIsometricController(): CameraController {
  return { id: 'isometric', sample: () => isometricSample() };
}

export function createFocusController(
  overview: CameraController,
  point: () => [number, number, number] | undefined,
): CameraController {
  return {
    id: 'focus',
    sample() {
      const focus = point();
      if (!focus) {
        return overview.sample();
      }
      return focusSample(overview.sample(), focus);
    },
  };
}

export function createCameraRig(camera: THREE.OrthographicCamera, reducedMotion: boolean) {
  let controller: CameraController = createIsometricController();
  let snap = true;
  const target = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const look = new THREE.Vector3();

  return {
    use(next: CameraController, instant = false) {
      controller = next;
      snap = instant || reducedMotion;
    },
    setReducedMotion(value: boolean) {
      if (value) {
        snap = true;
      }
    },
    update(dt: number, reduced = false) {
      const sample = controller.sample();
      desired.set(sample.position[0], sample.position[1], sample.position[2]);
      look.set(sample.target[0], sample.target[1], sample.target[2]);
      const blend = snap || reduced ? 1 : 1 - Math.exp(-dt * 5);
      camera.position.lerp(desired, blend);
      target.lerp(look, blend);
      camera.zoom += (sample.zoom - camera.zoom) * blend;
      camera.lookAt(target);
      camera.updateProjectionMatrix();
      snap = false;
    },
  };
}
