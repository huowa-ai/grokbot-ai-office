import type { RelayError } from './errors.js';
import type { RelayEvent } from './schema.js';

export interface RelayRequest {
  provider: string;
  prompt: string;
  replyTo?: string;
  timeoutMs?: number;
  onOutputChunk?: (chunk: string) => void | Promise<void>;
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

export interface EventSink {
  emit(event: RelayEvent): Promise<void>;
}

export type { RelayEvent, RelayEventType } from './schema.js';
