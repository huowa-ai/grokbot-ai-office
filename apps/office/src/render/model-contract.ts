import type { AgentStatus } from '../scene/events.js';
import type { ZoneId } from '../styles/agents.js';

export const MODEL_STYLE_IDS = [
  'codex',
  'claude',
  'gemini',
  'workbuddy',
  'hermes',
  'openclaw',
  'deepseek',
  'generic',
] as const;

export type ModelStyleId = (typeof MODEL_STYLE_IDS)[number];

export const DESK_MODEL_IDS = ['desk_local', 'desk_cloud'] as const;

export type DeskModelId = (typeof DESK_MODEL_IDS)[number];

export const AVATAR_NODE_NAMES = ['Body', 'Head', 'ArmL', 'ArmR', 'LegL', 'LegR'] as const;

export type AvatarNodeName = (typeof AVATAR_NODE_NAMES)[number];

export const CLIP_NAMES = ['Idle', 'Typing', 'Sleep', 'RaiseHand', 'Walk', 'Stuck'] as const;

export type ClipName = (typeof CLIP_NAMES)[number];

export const PRIMARY_MATERIAL = 'MAT_Primary';

export const SCREEN_NODE = 'Screen';

const NAMED_STYLE: Record<string, ModelStyleId> = {
  codex: 'codex',
  claude: 'claude',
  gemini: 'gemini',
  codebuddy: 'workbuddy',
  workbuddy: 'workbuddy',
  hermes: 'hermes',
  openclaw: 'openclaw',
  deepseek: 'deepseek',
};

export function modelStyleId(provider: string): ModelStyleId {
  return NAMED_STYLE[provider] ?? 'generic';
}

export function modelUrl(id: string): string {
  return `/models/${id}.glb`;
}

export function deskModelId(zone: ZoneId): DeskModelId {
  return zone === 'cloud' ? 'desk_cloud' : 'desk_local';
}

export function clipForStatus(status: AgentStatus, walking: boolean): ClipName {
  if (walking) {
    return 'Walk';
  }
  if (status === 'working') {
    return 'Typing';
  }
  if (status === 'stuck') {
    return 'Stuck';
  }
  if (status === 'waiting_approval') {
    return 'RaiseHand';
  }
  if (status === 'idle') {
    return 'Sleep';
  }
  return 'Idle';
}

export function isClipName(value: string): value is ClipName {
  return (CLIP_NAMES as readonly string[]).includes(value);
}
