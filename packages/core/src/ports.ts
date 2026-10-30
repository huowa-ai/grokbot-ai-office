import type { RelayError } from './errors.js';

export interface RelayRequest {
  provider: string;
  prompt: string;
  replyTo?: string;
  timeoutMs?: number;
}

export interface RelayResult {
  ok: boolean;
  text?: string;
  error?: RelayError;
  durationMs: number;
}

export interface AdapterPort {
  readonly kind: 'cli' | 'http';
  call(req: RelayRequest, signal: AbortSignal): Promise<string>;
  selfcheck(): Promise<{ ok: boolean; detail: string }>;
}

export type RelayEventType = 'started' | 'replying_to' | 'done' | 'error';

export interface RelayEvent {
  v: 1;
  id: string;
  ts: string;
  provider: string;
  host: string;
  type: RelayEventType;
  requestId: string;
  replyTo?: string;
  durationMs?: number;
  error?: {
    code: string;
    message: string;
  };
}

export interface EventSink {
  emit(event: RelayEvent): Promise<void>;
}
