export const CLIENT_EVENT_TYPES = [
  'started',
  'replying_to',
  'done',
  'error',
  'output_chunk',
  'status',
] as const;

export type ClientEventType = (typeof CLIENT_EVENT_TYPES)[number];

export type AgentStatus = 'unknown' | 'idle' | 'working' | 'stuck' | 'waiting_approval' | 'handoff';

const STATUSES: ReadonlySet<string> = new Set([
  'idle',
  'working',
  'stuck',
  'waiting_approval',
  'handoff',
]);

export interface ClientEvent {
  v: 1;
  id: string;
  ts: string;
  type: ClientEventType;
  instance: string;
  provider: string;
  host: string;
  taskId?: string;
  payload: Record<string, unknown>;
}

export function parseClientEvent(value: unknown): ClientEvent | undefined {
  if (!isRecord(value) || value.v !== 1) {
    return undefined;
  }
  const type = value.type;
  if (typeof type !== 'string' || !(CLIENT_EVENT_TYPES as readonly string[]).includes(type)) {
    return undefined;
  }
  if (
    typeof value.id !== 'string' ||
    typeof value.ts !== 'string' ||
    typeof value.instance !== 'string' ||
    typeof value.provider !== 'string' ||
    typeof value.host !== 'string' ||
    value.instance.length === 0 ||
    value.provider.length === 0
  ) {
    return undefined;
  }
  if (!isRecord(value.payload)) {
    return undefined;
  }
  return {
    v: 1,
    id: value.id,
    ts: value.ts,
    type: type as ClientEventType,
    instance: value.instance,
    provider: value.provider,
    host: value.host,
    ...(typeof value.taskId === 'string' ? { taskId: value.taskId } : {}),
    payload: value.payload,
  };
}

export function isAgentStatus(value: string): value is Exclude<AgentStatus, 'unknown'> {
  return STATUSES.has(value);
}

export function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
