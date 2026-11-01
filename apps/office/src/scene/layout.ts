import { type ZoneId, zoneForHost } from '../styles/agents.js';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface SlotPlacement {
  x: number;
  z: number;
  rotationY: number;
}

export const BOSS_DESK: Vec3 = { x: 0, y: 0, z: 6.2 };

const ZONE_ORIGIN: Record<ZoneId, { x: number; z: number }> = {
  local: { x: -5.7, z: -0.2 },
  cloud: { x: 5.7, z: -0.2 },
  other: { x: 0, z: -6.2 },
};

const COLUMN_GAP = 2.4;
const ROW_GAP = 2.6;

export function slotPlacement(zone: ZoneId, slot: number): SlotPlacement {
  const col = slot % 3;
  const row = Math.floor(slot / 3);
  const origin = ZONE_ORIGIN[zone];
  return {
    x: origin.x + (col - 1) * COLUMN_GAP,
    z: origin.z - row * ROW_GAP,
    rotationY: 0,
  };
}

export function seatPosition(zone: ZoneId, slot: number): Vec3 {
  const place = slotPlacement(zone, slot);
  return { x: place.x + 0.78, y: 0, z: place.z + 0.08 };
}

export function zoneCenter(zone: ZoneId): Vec3 {
  const origin = ZONE_ORIGIN[zone];
  return { x: origin.x, y: 0, z: origin.z };
}

export function endpointForInstance(instance: string, seats: ReadonlyMap<string, Vec3>): Vec3 {
  const known = seats.get(instance);
  if (known) {
    return known;
  }
  const host = instance.includes('@') ? instance.slice(instance.lastIndexOf('@') + 1) : '';
  return zoneCenter(zoneForHost(host));
}

export type WalkPhase = 'outbound' | 'deliver' | 'return';

export function walkPosition(start: Vec3, end: Vec3, phase: WalkPhase, progress: number): Vec3 {
  const along =
    phase === 'outbound' ? smooth(progress) : phase === 'deliver' ? 1 : 1 - smooth(progress);
  return {
    x: lerp(start.x, end.x, along),
    y: 0,
    z: lerp(start.z, end.z, along),
  };
}

export function yawToward(from: Vec3, to: Vec3): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

export function smooth(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped * clamped * (3 - 2 * clamped);
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}
