import {
  type Accessory,
  type BodyShape,
  type DeskProp,
  type IdlePose,
  type OfficeStyleOverride,
  type Palette,
  type StyleCatalog,
  type TypingFlavor,
  emptyCatalog,
  isAccessory,
  isBodyShape,
  isDeskProp,
  isHexColor,
  isIdlePose,
  isTypingFlavor,
} from './agents.js';

export function parseStyleCatalog(value: unknown): StyleCatalog {
  if (!isRecord(value)) {
    return emptyCatalog();
  }
  return {
    providers: parseMap(value.providers),
    instances: parseMap(value.instances),
  };
}

export function mergeCatalogs(base: StyleCatalog, extra: StyleCatalog): StyleCatalog {
  return {
    providers: mergeMap(base.providers, extra.providers),
    instances: mergeMap(base.instances, extra.instances),
  };
}

export function parseStyleOverride(value: unknown): OfficeStyleOverride | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const override: OfficeStyleOverride = {};
  const body = readString(value.body);
  if (body && isBodyShape(body)) {
    override.body = body as BodyShape;
  }
  const accessory = readString(value.accessory);
  if (accessory && isAccessory(accessory)) {
    override.accessory = accessory as Accessory;
  }
  const desk = readString(value.deskProp) ?? readString(value.desk_prop);
  if (desk && isDeskProp(desk)) {
    override.deskProp = desk as DeskProp;
  }
  const idle = readString(value.idlePose) ?? readString(value.idle_pose);
  if (idle && isIdlePose(idle)) {
    override.idlePose = idle as IdlePose;
  }
  const typing = readString(value.typing);
  if (typing && isTypingFlavor(typing)) {
    override.typing = typing as TypingFlavor;
  }
  const bezel = readHex(value.bezel);
  if (bezel) {
    override.bezel = bezel;
  }
  const nameTag = readHex(value.nameTag) ?? readHex(value.name_tag);
  if (nameTag) {
    override.nameTag = nameTag;
  }
  if (isRecord(value.palette)) {
    const palette: Partial<Palette> = {};
    const primary = readHex(value.palette.primary);
    const secondary = readHex(value.palette.secondary);
    const accent = readHex(value.palette.accent);
    if (primary) {
      palette.primary = primary;
    }
    if (secondary) {
      palette.secondary = secondary;
    }
    if (accent) {
      palette.accent = accent;
    }
    if (primary || secondary || accent) {
      override.palette = palette;
    }
  }
  return Object.keys(override).length > 0 ? override : undefined;
}

function parseMap(value: unknown): Record<string, OfficeStyleOverride> {
  if (!isRecord(value)) {
    return {};
  }
  const map: Record<string, OfficeStyleOverride> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!/^[a-z0-9@][a-z0-9@_-]*$/.test(key)) {
      continue;
    }
    const parsed = parseStyleOverride(item);
    if (parsed) {
      map[key] = parsed;
    }
  }
  return map;
}

function mergeMap(
  base: Record<string, OfficeStyleOverride>,
  extra: Record<string, OfficeStyleOverride>,
): Record<string, OfficeStyleOverride> {
  const merged: Record<string, OfficeStyleOverride> = { ...base };
  for (const [key, override] of Object.entries(extra)) {
    merged[key] = mergeOverride(merged[key], override);
  }
  return merged;
}

function mergeOverride(
  base: OfficeStyleOverride | undefined,
  extra: OfficeStyleOverride,
): OfficeStyleOverride {
  if (!base) {
    return extra;
  }
  return {
    ...base,
    ...extra,
    ...(base.palette || extra.palette ? { palette: { ...base.palette, ...extra.palette } } : {}),
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readHex(value: unknown): string | undefined {
  return typeof value === 'string' && isHexColor(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
