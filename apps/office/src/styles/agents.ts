export const BODY_SHAPES = [
  'robot',
  'round',
  'twin',
  'headset',
  'messenger',
  'lobster',
  'whale',
  'blob',
] as const;

export const ACCESSORIES = [
  'antenna',
  'scarf',
  'sparkles',
  'headset',
  'wings',
  'claws',
  'spout',
  'none',
] as const;

export const DESK_PROPS = [
  'keyboard',
  'books',
  'stars',
  'plant',
  'satchel',
  'shell',
  'wave',
  'mug',
] as const;

export const IDLE_POSES = ['sleep', 'sway', 'hover', 'perch', 'bob'] as const;

export const TYPING_FLAVORS = ['keys', 'nod', 'flip', 'clack', 'wings', 'claws', 'tail'] as const;

export type BodyShape = (typeof BODY_SHAPES)[number];
export type Accessory = (typeof ACCESSORIES)[number];
export type DeskProp = (typeof DESK_PROPS)[number];
export type IdlePose = (typeof IDLE_POSES)[number];
export type TypingFlavor = (typeof TYPING_FLAVORS)[number];

export interface Palette {
  primary: string;
  secondary: string;
  accent: string;
}

export interface OfficeStyleOverride {
  body?: BodyShape;
  palette?: Partial<Palette>;
  accessory?: Accessory;
  deskProp?: DeskProp;
  bezel?: string;
  nameTag?: string;
  idlePose?: IdlePose;
  typing?: TypingFlavor;
}

export interface StyleCatalog {
  providers: Record<string, OfficeStyleOverride>;
  instances: Record<string, OfficeStyleOverride>;
}

export type ZoneId = 'local' | 'cloud' | 'other';

export interface HostAccent {
  zone: ZoneId;
  desk: string;
  deskLeg: string;
  lamp: string;
  halo: string;
  badge: string;
}

export interface CharacterProfile {
  body: BodyShape;
  palette: Palette;
  accessory: Accessory;
  deskProp: DeskProp;
  bezel: string;
  nameTag: string;
  idlePose: IdlePose;
  typing: TypingFlavor;
}

export interface ResolvedStyle extends CharacterProfile {
  provider: string;
  host: string;
  source: 'builtin' | 'hash' | 'override';
  hostAccent: HostAccent;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

const LOCAL_ACCENT: HostAccent = {
  zone: 'local',
  desk: '#b57a45',
  deskLeg: '#6e4324',
  lamp: '#ffd27a',
  halo: '#ffd27a',
  badge: '#c4843c',
};

const CLOUD_ACCENT: HostAccent = {
  zone: 'cloud',
  desk: '#d5e6f4',
  deskLeg: '#8eacc4',
  lamp: '#b9dcff',
  halo: '#8ec8ff',
  badge: '#6aa6d8',
};

const OTHER_ACCENT: HostAccent = {
  zone: 'other',
  desk: '#cbbba6',
  deskLeg: '#8a7864',
  lamp: '#f0e2cc',
  halo: '#d9cbb8',
  badge: '#a89480',
};

function profile(
  body: BodyShape,
  palette: Palette,
  accessory: Accessory,
  deskProp: DeskProp,
  idlePose: IdlePose,
  typing: TypingFlavor,
): CharacterProfile {
  return {
    body,
    palette,
    accessory,
    deskProp,
    bezel: palette.primary,
    nameTag: palette.primary,
    idlePose,
    typing,
  };
}

const BUILTINS: Record<string, CharacterProfile> = {
  codex: profile(
    'robot',
    { primary: '#14615f', secondary: '#d7f4f1', accent: '#083633' },
    'antenna',
    'keyboard',
    'hover',
    'keys',
  ),
  claude: profile(
    'round',
    { primary: '#c46b4a', secondary: '#f6d2c2', accent: '#7a3419' },
    'scarf',
    'books',
    'sway',
    'nod',
  ),
  gemini: profile(
    'twin',
    { primary: '#3b6fe0', secondary: '#e4dcff', accent: '#7a4de0' },
    'sparkles',
    'stars',
    'hover',
    'flip',
  ),
  codebuddy: profile(
    'headset',
    { primary: '#2f9e6b', secondary: '#d7f5e4', accent: '#1d6846' },
    'headset',
    'plant',
    'bob',
    'clack',
  ),
  hermes: profile(
    'messenger',
    { primary: '#e6c36a', secondary: '#fff8ea', accent: '#8a6a22' },
    'wings',
    'satchel',
    'perch',
    'wings',
  ),
  openclaw: profile(
    'lobster',
    { primary: '#d64545', secondary: '#ffd0c4', accent: '#7d1f24' },
    'claws',
    'shell',
    'bob',
    'claws',
  ),
  deepseek: profile(
    'whale',
    { primary: '#143d66', secondary: '#d5e8f6', accent: '#7eb6d9' },
    'spout',
    'wave',
    'sway',
    'tail',
  ),
};

BUILTINS.workbuddy = BUILTINS.codebuddy as CharacterProfile;

const FALLBACK_PALETTES: readonly Palette[] = [
  { primary: '#d4785a', secondary: '#f8e0d6', accent: '#6b3a2a' },
  { primary: '#5b8c5a', secondary: '#e1f3df', accent: '#2d5a32' },
  { primary: '#c4893b', secondary: '#f8ead0', accent: '#6d4a16' },
  { primary: '#6a7eb0', secondary: '#e3e8f8', accent: '#303e66' },
  { primary: '#b25d8a', secondary: '#f8e4ef', accent: '#6a3152' },
  { primary: '#3f8f8a', secondary: '#daf3f0', accent: '#1e5551' },
];

const FALLBACK_BODIES: readonly BodyShape[] = ['blob', 'round'];
const FALLBACK_ACCESSORIES: readonly Accessory[] = ['none', 'scarf', 'headset'];
const FALLBACK_PROPS: readonly DeskProp[] = ['mug', 'books', 'plant'];
const FALLBACK_IDLES: readonly IdlePose[] = ['sway', 'bob', 'sleep'];
const FALLBACK_TYPING: readonly TypingFlavor[] = ['keys', 'nod', 'clack'];

export function emptyCatalog(): StyleCatalog {
  return { providers: {}, instances: {} };
}

export function zoneForHost(host: string): ZoneId {
  if (host === 'mac' || host === 'local') {
    return 'local';
  }
  if (host === 'cloud') {
    return 'cloud';
  }
  return 'other';
}

export function accentForHost(host: string): HostAccent {
  const zone = zoneForHost(host);
  if (zone === 'local') {
    return LOCAL_ACCENT;
  }
  if (zone === 'cloud') {
    return CLOUD_ACCENT;
  }
  return OTHER_ACCENT;
}

export function hashProvider(name: string): number {
  let hash = 2166136261;
  for (const char of name) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function resolveAgentStyle(
  provider: string,
  host: string,
  catalog: StyleCatalog = emptyCatalog(),
): ResolvedStyle {
  const builtin = BUILTINS[provider];
  const base = builtin ?? hashProfile(provider);
  const instanceKey = host.length > 0 ? `${provider}@${host}` : provider;
  const merged = applyOverride(
    applyOverride(base, catalog.providers[provider]),
    catalog.instances[instanceKey],
  );
  const hasOverride =
    catalog.providers[provider] !== undefined || catalog.instances[instanceKey] !== undefined;
  return {
    ...merged,
    provider,
    host,
    source: hasOverride ? 'override' : builtin ? 'builtin' : 'hash',
    hostAccent: accentForHost(host),
  };
}

export function hashProfile(provider: string): CharacterProfile {
  const hash = hashProvider(provider);
  const palette = pick(FALLBACK_PALETTES, hash, 1);
  return {
    body: pick(FALLBACK_BODIES, hash, 2),
    palette,
    accessory: pick(FALLBACK_ACCESSORIES, hash, 3),
    deskProp: pick(FALLBACK_PROPS, hash, 4),
    bezel: palette.accent,
    nameTag: palette.primary,
    idlePose: pick(FALLBACK_IDLES, hash, 5),
    typing: pick(FALLBACK_TYPING, hash, 6),
  };
}

function applyOverride(
  base: CharacterProfile,
  override: OfficeStyleOverride | undefined,
): CharacterProfile {
  if (!override) {
    return base;
  }
  return {
    body: override.body ?? base.body,
    palette: {
      primary: override.palette?.primary ?? base.palette.primary,
      secondary: override.palette?.secondary ?? base.palette.secondary,
      accent: override.palette?.accent ?? base.palette.accent,
    },
    accessory: override.accessory ?? base.accessory,
    deskProp: override.deskProp ?? base.deskProp,
    bezel: override.bezel ?? base.bezel,
    nameTag: override.nameTag ?? base.nameTag,
    idlePose: override.idlePose ?? base.idlePose,
    typing: override.typing ?? base.typing,
  };
}

function pick<T>(list: readonly T[], hash: number, salt: number): T {
  const mixed = Math.imul(hash ^ salt, 16777619) >>> 0;
  const item = list[mixed % list.length];
  if (item === undefined) {
    throw new Error('样式列表为空');
  }
  return item;
}

export function isBodyShape(value: string): value is BodyShape {
  return (BODY_SHAPES as readonly string[]).includes(value);
}

export function isAccessory(value: string): value is Accessory {
  return (ACCESSORIES as readonly string[]).includes(value);
}

export function isDeskProp(value: string): value is DeskProp {
  return (DESK_PROPS as readonly string[]).includes(value);
}

export function isIdlePose(value: string): value is IdlePose {
  return (IDLE_POSES as readonly string[]).includes(value);
}

export function isTypingFlavor(value: string): value is TypingFlavor {
  return (TYPING_FLAVORS as readonly string[]).includes(value);
}

export function isHexColor(value: string): boolean {
  return HEX.test(value);
}
