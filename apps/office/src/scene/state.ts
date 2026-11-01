import { zoneForHost } from '../styles/agents.js';
import { type AgentStatus, type ClientEvent, isAgentStatus, readString } from './events.js';
import type { WalkPhase } from './layout.js';
import { appendCapped } from './tail.js';

export interface HandoffMotion {
  eventId: string;
  from: string;
  to: string;
  filePath: string;
  note?: string;
  phase: WalkPhase;
  progress: number;
}

export interface SceneAgent {
  instance: string;
  provider: string;
  host: string;
  zone: ReturnType<typeof zoneForHost>;
  slot: number;
  status: AgentStatus;
  statusSource?: string;
  taskId?: string;
  taskPreview?: string;
  updatedAt?: string;
  screen: string;
  screenEpoch: number;
  hookActive: boolean;
  fit: number;
  stuck?: { code?: string; reason: string };
  approval?: { approvalId?: string; summary: string };
  handoff?: HandoffMotion;
}

export interface SceneState {
  order: string[];
  byId: Record<string, SceneAgent>;
  focus?: string;
}

export interface SnapshotInstance {
  instance: string;
  provider: string;
  host: string;
  status?: string;
  statusSource?: string;
  taskId?: string;
  taskPreview?: string;
  updatedAt?: string;
  terminalTail?: string;
  hookActive?: boolean;
  detail?: {
    code?: string;
    reason?: string;
    approvalId?: string;
    summary?: string;
    approved?: boolean;
    from?: string;
    to?: string;
    filePath?: string;
    note?: string;
  };
}

export interface OfficeStateSnapshot {
  v?: number;
  instances?: SnapshotInstance[];
}

const FIT_MS = 700;
const OUTBOUND_MS = 2400;
const DELIVER_MS = 400;
const RETURN_MS = 2400;

export function createSceneState(): SceneState {
  return { order: [], byId: {} };
}

export function listAgents(state: SceneState): SceneAgent[] {
  const agents: SceneAgent[] = [];
  for (const id of state.order) {
    const agent = state.byId[id];
    if (agent) {
      agents.push(agent);
    }
  }
  return agents;
}

export function applySnapshot(state: SceneState, snapshot: OfficeStateSnapshot): SceneState {
  const instances = snapshot.instances ?? [];
  const seen = new Set<string>();
  let next = state;
  for (const item of instances) {
    if (item.instance.length === 0) {
      continue;
    }
    seen.add(item.instance);
    const zone = zoneForHost(item.host);
    const created = ensure(next, {
      instance: item.instance,
      provider: item.provider,
      host: item.host,
      zone,
    });
    next = created.state;
    const current = next.byId[item.instance];
    if (!current) {
      continue;
    }
    const status = item.status && isAgentStatus(item.status) ? item.status : 'unknown';
    const screen = item.terminalTail ?? '';
    const handoff = handoffFromDetail(item.detail, current.handoff, status);
    next = put(next, {
      ...current,
      provider: item.provider || current.provider,
      host: item.host,
      zone,
      status,
      ...(item.statusSource ? { statusSource: item.statusSource } : {}),
      ...(item.taskId ? { taskId: item.taskId } : {}),
      ...(item.taskPreview ? { taskPreview: item.taskPreview } : {}),
      ...(item.updatedAt ? { updatedAt: item.updatedAt } : {}),
      screen,
      screenEpoch: screen === current.screen ? current.screenEpoch : current.screenEpoch + 1,
      hookActive: item.hookActive === true,
      stuck: status === 'stuck' ? stuckFrom(item.detail) : undefined,
      approval: status === 'waiting_approval' ? approvalFrom(item.detail) : undefined,
      ...(handoff ? { handoff } : { handoff: undefined }),
    });
  }
  const order = next.order.filter((id) => seen.has(id));
  const byId: Record<string, SceneAgent> = {};
  for (const id of order) {
    const agent = next.byId[id];
    if (agent) {
      byId[id] = agent;
    }
  }
  const focus = next.focus && seen.has(next.focus) ? next.focus : undefined;
  return { order, byId, ...(focus ? { focus } : {}) };
}

export function applyEvent(state: SceneState, event: ClientEvent): SceneState {
  const zone = zoneForHost(event.host);
  const ensured = ensure(state, {
    instance: event.instance,
    provider: event.provider,
    host: event.host,
    zone,
  });
  let next = ensured.state;
  const agent = next.byId[event.instance];
  if (!agent) {
    return next;
  }
  const withMeta = put(next, {
    ...agent,
    updatedAt: event.ts,
    ...(event.taskId ? { taskId: event.taskId } : {}),
  });
  next = withMeta;

  if (event.type === 'started') {
    const current = next.byId[event.instance];
    if (!current) {
      return next;
    }
    const preview = readString(event.payload.promptPreview);
    return put(next, {
      ...current,
      screen: '',
      screenEpoch: current.screenEpoch + 1,
      hookActive: false,
      stuck: undefined,
      approval: undefined,
      ...(preview ? { taskPreview: preview } : {}),
    });
  }

  if (event.type === 'output_chunk') {
    const current = next.byId[event.instance];
    if (!current) {
      return next;
    }
    if (
      current.taskId !== undefined &&
      event.taskId !== undefined &&
      event.taskId !== current.taskId
    ) {
      return next;
    }
    const text = typeof event.payload.text === 'string' ? event.payload.text : '';
    return put(next, { ...current, screen: appendCapped(current.screen, text) });
  }

  if (event.type === 'error') {
    const current = next.byId[event.instance];
    if (!current) {
      return next;
    }
    const tail = readString(event.payload.tail);
    if (!tail) {
      return next;
    }
    return put(next, {
      ...current,
      screen: tail,
      screenEpoch: current.screenEpoch + 1,
    });
  }

  if (event.type !== 'status') {
    return next;
  }

  const stateName = readString(event.payload.state);
  if (!stateName || !isAgentStatus(stateName)) {
    return next;
  }
  const source = readString(event.payload.source);
  const current = next.byId[event.instance];
  if (!current) {
    return next;
  }
  if (source === 'heuristic') {
    if (current.hookActive || (current.status !== 'working' && current.status !== 'unknown')) {
      return next;
    }
  }
  let hookActive = current.hookActive;
  if (source === 'hook') {
    hookActive = true;
  }
  if (source === 'lifecycle' && (stateName === 'idle' || stateName === 'stuck')) {
    hookActive = false;
  }
  const previewField = readString(event.payload.taskPreview);
  const taskPreview =
    stateName === 'working' ? (previewField ?? current.taskPreview) : current.taskPreview;
  const stuck = stateName === 'stuck' ? stuckFrom(event.payload) : undefined;
  const approval = stateName === 'waiting_approval' ? approvalFrom(event.payload) : undefined;
  let handoff = current.handoff;
  if (stateName === 'handoff') {
    const from = readString(event.payload.from) ?? event.instance;
    const to = readString(event.payload.to);
    const filePath = readString(event.payload.filePath);
    if (to && filePath) {
      const eventId = event.id;
      if (!handoff || handoff.eventId !== eventId) {
        handoff = {
          eventId,
          from,
          to,
          filePath,
          ...(readString(event.payload.note) ? { note: readString(event.payload.note) } : {}),
          phase: 'outbound',
          progress: 0,
        };
      }
    }
  }
  return put(next, {
    ...current,
    status: stateName,
    ...(source ? { statusSource: source } : {}),
    ...(taskPreview ? { taskPreview } : {}),
    hookActive,
    stuck,
    approval,
    ...(handoff ? { handoff } : { handoff: undefined }),
  });
}

export function tickScene(
  state: SceneState,
  dtMs: number,
  options: { reducedMotion?: boolean } = {},
): SceneState {
  const dt = Math.max(0, dtMs);
  let next = state;
  for (const id of state.order) {
    const agent = next.byId[id];
    if (!agent) {
      continue;
    }
    const fit = options.reducedMotion ? 1 : Math.min(1, agent.fit + dt / FIT_MS);
    const handoff = advanceHandoff(agent.handoff, dt, options.reducedMotion === true);
    if (fit === agent.fit && handoff === agent.handoff) {
      continue;
    }
    next = put(next, {
      ...agent,
      fit,
      ...(handoff ? { handoff } : { handoff: undefined }),
    });
  }
  return next;
}

export function setFocus(state: SceneState, instance: string | undefined): SceneState {
  if (instance === undefined) {
    if (state.focus === undefined) {
      return state;
    }
    return { order: state.order, byId: state.byId };
  }
  if (!state.byId[instance]) {
    return state;
  }
  return { ...state, focus: instance };
}

function advanceHandoff(
  motion: HandoffMotion | undefined,
  dt: number,
  reducedMotion: boolean,
): HandoffMotion | undefined {
  if (!motion) {
    return undefined;
  }
  if (reducedMotion) {
    return undefined;
  }
  let phase = motion.phase;
  let progress = motion.progress + dt / duration(phase);
  while (progress >= 1) {
    progress -= 1;
    if (phase === 'outbound') {
      phase = 'deliver';
      continue;
    }
    if (phase === 'deliver') {
      phase = 'return';
      continue;
    }
    return undefined;
  }
  return { ...motion, phase, progress };
}

function duration(phase: WalkPhase): number {
  if (phase === 'outbound') {
    return OUTBOUND_MS;
  }
  if (phase === 'deliver') {
    return DELIVER_MS;
  }
  return RETURN_MS;
}

function handoffFromDetail(
  detail: SnapshotInstance['detail'],
  current: HandoffMotion | undefined,
  status: AgentStatus,
): HandoffMotion | undefined {
  const from = readString(detail?.from);
  const to = readString(detail?.to);
  const filePath = readString(detail?.filePath);
  if (status !== 'handoff' || !from || !to || !filePath) {
    return undefined;
  }
  const eventId = `${from}->${to}:${filePath}`;
  if (current && (current.eventId === eventId || current.filePath === filePath)) {
    return current;
  }
  const note = readString(detail?.note);
  return {
    eventId,
    from,
    to,
    filePath,
    ...(note ? { note } : {}),
    phase: 'outbound',
    progress: 0,
  };
}

function stuckFrom(detail: Record<string, unknown> | undefined): { code?: string; reason: string } {
  const code = detail ? readString(detail.code) : undefined;
  const reason = detail ? readString(detail.reason) : undefined;
  return {
    ...(code ? { code } : {}),
    reason: reason ?? '卡住了',
  };
}

function approvalFrom(detail: Record<string, unknown> | undefined): {
  approvalId?: string;
  summary: string;
} {
  const approvalId = detail ? readString(detail.approvalId) : undefined;
  const summary = detail ? readString(detail.summary) : undefined;
  return {
    ...(approvalId ? { approvalId } : {}),
    summary: summary ?? '等待批准',
  };
}

function ensure(
  state: SceneState,
  input: { instance: string; provider: string; host: string; zone: SceneAgent['zone'] },
): { state: SceneState; created: boolean } {
  const existing = state.byId[input.instance];
  if (existing) {
    return { state, created: false };
  }
  const slot = nextSlot(state, input.zone);
  const agent: SceneAgent = {
    instance: input.instance,
    provider: input.provider,
    host: input.host,
    zone: input.zone,
    slot,
    status: 'unknown',
    screen: '',
    screenEpoch: 0,
    hookActive: false,
    fit: 0,
  };
  return {
    state: {
      ...state,
      order: [...state.order, input.instance],
      byId: { ...state.byId, [input.instance]: agent },
    },
    created: true,
  };
}

function nextSlot(state: SceneState, zone: SceneAgent['zone']): number {
  const used = new Set<number>();
  for (const agent of Object.values(state.byId)) {
    if (agent.zone === zone) {
      used.add(agent.slot);
    }
  }
  let slot = 0;
  while (used.has(slot)) {
    slot += 1;
  }
  return slot;
}

function put(state: SceneState, agent: SceneAgent): SceneState {
  return { ...state, byId: { ...state.byId, [agent.instance]: agent } };
}
