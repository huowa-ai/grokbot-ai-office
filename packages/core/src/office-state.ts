import {
  type AgentState,
  type RelayEvent,
  type StatusSource,
  TERMINAL_TAIL_MAX_BYTES,
  appendTail,
} from './schema.js';

export interface OutputChunkSnapshot {
  seq: number;
  text: string;
  ts: string;
  taskId?: string;
}

export interface InstanceDetail {
  code?: string;
  reason?: string;
  approvalId?: string;
  summary?: string;
  approved?: boolean;
  from?: string;
  to?: string;
  filePath?: string;
  note?: string;
}

export interface InstanceSnapshot {
  instance: string;
  provider: string;
  host: string;
  status: AgentState | 'unknown';
  statusSource?: StatusSource;
  taskId?: string;
  taskPreview?: string;
  updatedAt?: string;
  terminalTail: string;
  chunks: OutputChunkSnapshot[];
  hookActive: boolean;
  detail?: InstanceDetail;
}

export interface OfficeSnapshot {
  v: 1;
  instances: InstanceSnapshot[];
}

interface MutableInstance {
  instance: string;
  provider: string;
  host: string;
  status: AgentState | 'unknown';
  statusSource?: StatusSource;
  taskId?: string;
  taskPreview?: string;
  updatedAt?: string;
  terminalTail: string;
  chunks: OutputChunkSnapshot[];
  hookActive: boolean;
  detail?: InstanceDetail;
}

const DEFAULT_CHUNK_LIMIT = 20;

export function createOfficeState(options: { chunkLimit?: number } = {}): {
  apply(event: RelayEvent): void;
  snapshot(): OfficeSnapshot;
} {
  const chunkLimit = normalizeChunkLimit(options.chunkLimit);
  const instances = new Map<string, MutableInstance>();

  const ensure = (event: RelayEvent): MutableInstance => {
    const existing = instances.get(event.instance);
    if (existing) {
      return existing;
    }
    const created: MutableInstance = {
      instance: event.instance,
      provider: event.provider,
      host: event.host,
      status: 'unknown',
      terminalTail: '',
      chunks: [],
      hookActive: false,
    };
    instances.set(event.instance, created);
    return created;
  };

  return {
    apply(event: RelayEvent): void {
      const slot = ensure(event);
      slot.updatedAt = event.ts;
      if (event.taskId !== undefined) {
        slot.taskId = event.taskId;
      }

      if (event.type === 'started') {
        slot.taskPreview = event.payload.promptPreview;
        slot.chunks = [];
        slot.terminalTail = '';
        slot.hookActive = false;
        slot.detail = undefined;
        return;
      }

      if (event.type === 'output_chunk') {
        if (
          slot.taskId !== undefined &&
          event.taskId !== undefined &&
          event.taskId !== slot.taskId
        ) {
          return;
        }
        slot.terminalTail = appendTail(
          slot.terminalTail,
          event.payload.text,
          TERMINAL_TAIL_MAX_BYTES,
        );
        slot.chunks.push({
          seq: event.payload.seq,
          text: event.payload.text,
          ts: event.ts,
          ...(event.taskId === undefined ? {} : { taskId: event.taskId }),
        });
        while (slot.chunks.length > chunkLimit) {
          slot.chunks.shift();
        }
        return;
      }

      if (
        event.type === 'error' &&
        event.payload.tail !== undefined &&
        event.payload.tail.length > 0
      ) {
        slot.terminalTail = event.payload.tail;
        return;
      }

      if (event.type !== 'status') {
        return;
      }

      const payload = event.payload;
      if (payload.source === 'heuristic') {
        if (slot.hookActive || (slot.status !== 'working' && slot.status !== 'unknown')) {
          return;
        }
      }
      if (payload.source === 'hook') {
        slot.hookActive = true;
      }
      if (
        payload.source === 'lifecycle' &&
        (payload.state === 'idle' || payload.state === 'stuck')
      ) {
        slot.hookActive = false;
      }

      slot.status = payload.state;
      slot.statusSource = payload.source;
      slot.detail = detailFrom(payload);
      if (payload.state === 'working' && payload.taskPreview !== undefined) {
        slot.taskPreview = payload.taskPreview;
      }
      if (payload.state === 'stuck' && payload.tail !== undefined && payload.tail.length > 0) {
        slot.terminalTail = payload.tail;
      }
    },
    snapshot(): OfficeSnapshot {
      const list = [...instances.values()]
        .map((slot) => ({
          instance: slot.instance,
          provider: slot.provider,
          host: slot.host,
          status: slot.status,
          ...(slot.statusSource === undefined ? {} : { statusSource: slot.statusSource }),
          ...(slot.taskId === undefined ? {} : { taskId: slot.taskId }),
          ...(slot.taskPreview === undefined ? {} : { taskPreview: slot.taskPreview }),
          ...(slot.updatedAt === undefined ? {} : { updatedAt: slot.updatedAt }),
          terminalTail: slot.terminalTail,
          chunks: [...slot.chunks],
          hookActive: slot.hookActive,
          ...(slot.detail === undefined ? {} : { detail: { ...slot.detail } }),
        }))
        .sort((left, right) => left.instance.localeCompare(right.instance));
      return { v: 1, instances: list };
    },
  };
}

export function reduceEvents(
  events: readonly RelayEvent[],
  options: { chunkLimit?: number } = {},
): OfficeSnapshot {
  const state = createOfficeState(options);
  for (const event of events) {
    state.apply(event);
  }
  return state.snapshot();
}

export function readStateChunkLimit(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.RELAY_STATE_CHUNK_LIMIT;
  if (raw === undefined || raw.trim().length === 0 || !/^\d+$/.test(raw.trim())) {
    return DEFAULT_CHUNK_LIMIT;
  }
  return normalizeChunkLimit(Number(raw));
}

function normalizeChunkLimit(value: number | undefined): number {
  if (value === undefined || !Number.isInteger(value) || value < 1) {
    return DEFAULT_CHUNK_LIMIT;
  }
  return Math.min(200, value);
}

function detailFrom(
  payload: Extract<RelayEvent, { type: 'status' }>['payload'],
): InstanceDetail | undefined {
  if (payload.state === 'stuck') {
    return { code: payload.code, reason: payload.reason };
  }
  if (payload.state === 'waiting_approval') {
    return { approvalId: payload.approvalId, summary: payload.summary };
  }
  if (payload.state === 'handoff') {
    return {
      from: payload.from,
      to: payload.to,
      filePath: payload.filePath,
      ...(payload.note === undefined ? {} : { note: payload.note }),
    };
  }
  if (
    payload.state === 'idle' &&
    payload.approvalId !== undefined &&
    payload.approved !== undefined
  ) {
    return { approvalId: payload.approvalId, approved: payload.approved };
  }
  return undefined;
}
