import * as THREE from 'three';

const shared = new Map<string, THREE.MeshLambertMaterial>();

export function lambert(hex: string): THREE.MeshLambertMaterial {
  const cached = shared.get(hex);
  if (cached) {
    return cached;
  }
  const material = new THREE.MeshLambertMaterial({ color: hex, flatShading: true });
  shared.set(hex, material);
  return material;
}

export function beaconMaterial(hex: string): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({
    color: hex,
    emissive: hex,
    emissiveIntensity: 0.35,
    flatShading: true,
  });
}

export function paint(mesh: THREE.Mesh, cast = true): THREE.Mesh {
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  return mesh;
}
