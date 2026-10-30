import { z } from 'zod';

import { ERROR_CODES, RelayError, isRelayErrorCode } from './errors.js';
import { redactSecrets } from './redact.js';

export const EVENT_TYPES = [
  'started',
  'replying_to',
  'done',
  'error',
  'output_chunk',
  'status',
] as const;

export type RelayEventType = (typeof EVENT_TYPES)[number];

export const AGENT_STATES = ['idle', 'working', 'stuck', 'waiting_approval', 'handoff'] as const;

export type AgentState = (typeof AGENT_STATES)[number];

export const STATUS_SOURCES = ['lifecycle', 'heuristic', 'hook'] as const;

export type StatusSource = (typeof STATUS_SOURCES)[number];

export const DEFAULT_PROMPT_PREVIEW_CHARS = 80;
export const MAX_PROMPT_PREVIEW_CHARS = 500;
export const DEFAULT_OUTPUT_CHUNK_CHARS = 1024;
export const MAX_OUTPUT_CHUNK_CHARS = 1024;
export const TERMINAL_TAIL_MAX_BYTES = 8192;
const MAX_CHUNK_BYTES = 1024;

const instancePart = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const sourceSchema = z.enum(STATUS_SOURCES);

const baseEvent = {
  v: z.literal(1),
  id: z.string().min(1).max(200),
  ts: z.string().datetime(),
  instance: z.string().min(1).max(200),
  provider: z.string().min(1).max(200),
  host: z.string().max(200),
  taskId: z.string().min(1).max(200).optional(),
};

const startedSchema = z
  .object({
    ...baseEvent,
    type: z.literal('started'),
    payload: z
      .object({
        promptPreview: z.string().max(MAX_PROMPT_PREVIEW_CHARS).optional(),
      })
      .strict(),
  })
  .strict();

const replyingSchema = z
  .object({
    ...baseEvent,
    type: z.literal('replying_to'),
    payload: z
      .object({
        replyTo: z.string().min(1).max(200),
      })
      .strict(),
  })
  .strict();

const doneSchema = z
  .object({
    ...baseEvent,
    type: z.literal('done'),
    payload: z
      .object({
        durationMs: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

const errorSchema = z
  .object({
    ...baseEvent,
    type: z.literal('error'),
    payload: z
      .object({
        durationMs: z.number().int().nonnegative().optional(),
        code: z.enum(ERROR_CODES),
        message: z.string().max(2000),
        tail: z.string().max(TERMINAL_TAIL_MAX_BYTES).optional(),
      })
      .strict(),
  })
  .strict();

const outputChunkSchema = z
  .object({
    ...baseEvent,
    type: z.literal('output_chunk'),
    payload: z
      .object({
        seq: z.number().int().positive(),
        text: z.string().max(MAX_OUTPUT_CHUNK_CHARS),
      })
      .strict(),
  })
  .strict();

const statusSchema = z
  .object({
    ...baseEvent,
    type: z.literal('status'),
    payload: z.discriminatedUnion('state', [
      z
        .object({
          state: z.literal('idle'),
          source: sourceSchema,
          approvalId: z.string().min(1).max(200).optional(),
          approved: z.boolean().optional(),
        })
        .strict(),
      z
        .object({
          state: z.literal('working'),
          source: sourceSchema,
          taskPreview: z.string().max(MAX_PROMPT_PREVIEW_CHARS).optional(),
        })
        .strict(),
      z
        .object({
          state: z.literal('stuck'),
          source: sourceSchema,
          code: z.enum(ERROR_CODES),
          reason: z.string().min(1).max(200),
          tail: z.string().max(TERMINAL_TAIL_MAX_BYTES).optional(),
        })
        .strict(),
      z
        .object({
          state: z.literal('waiting_approval'),
          source: sourceSchema,
          approvalId: z.string().min(1).max(200),
          summary: z.string().min(1).max(200),
        })
        .strict(),
      z
        .object({
          state: z.literal('handoff'),
          source: sourceSchema,
          from: z.string().min(1).max(200),
          to: z.string().min(1).max(200),
          filePath: z.string().min(1).max(500),
          note: z.string().max(200).optional(),
        })
        .strict(),
    ]),
  })
  .strict();

export const relayEventSchema = z.discriminatedUnion('type', [
  startedSchema,
  replyingSchema,
  doneSchema,
  errorSchema,
  outputChunkSchema,
  statusSchema,
]);

export type RelayEvent = z.infer<typeof relayEventSchema>;

export function formatInstance(provider: string, host: string): string {
  if (host.length === 0) {
    return provider;
  }
  return `${provider}@${host}`;
}

export function parseInstance(value: string): { provider: string; host: string } {
  const separator = value.indexOf('@');
  if (separator <= 0 || separator !== value.lastIndexOf('@') || separator === value.length - 1) {
    throw new RelayError('CONFIG_INVALID', '实例标识必须是 provider@host');
  }
  const provider = value.slice(0, separator);
  const host = value.slice(separator + 1);
  if (!instancePart.test(provider) || !instancePart.test(host)) {
    throw new RelayError('CONFIG_INVALID', '实例标识的两边都必须是小写字母、数字和连字符');
  }
  return { provider, host };
}

export function previewText(value: string, limit: number): string | undefined {
  if (limit <= 0) {
    return undefined;
  }
  const capped = Math.min(limit, MAX_PROMPT_PREVIEW_CHARS);
  const redacted = redactSecrets(value);
  const chars = [...redacted];
  if (chars.length <= capped) {
    return redacted;
  }
  if (capped === 1) {
    return '…';
  }
  return `${chars.slice(0, capped - 1).join('')}…`;
}

export function readPromptPreviewChars(env: NodeJS.ProcessEnv = process.env): number {
  return readBoundedInt(
    env.RELAY_PROMPT_PREVIEW_CHARS,
    DEFAULT_PROMPT_PREVIEW_CHARS,
    0,
    MAX_PROMPT_PREVIEW_CHARS,
  );
}

export function readOutputChunkChars(env: NodeJS.ProcessEnv = process.env): number {
  return readBoundedInt(
    env.RELAY_OUTPUT_CHUNK_CHARS,
    DEFAULT_OUTPUT_CHUNK_CHARS,
    1,
    MAX_OUTPUT_CHUNK_CHARS,
  );
}

export function splitOutput(text: string, maxChars: number, maxBytes = MAX_CHUNK_BYTES): string[] {
  if (text.length === 0) {
    return [];
  }
  const limitChars = Math.max(1, Math.min(maxChars, MAX_OUTPUT_CHUNK_CHARS));
  const limitBytes = Math.max(1, maxBytes);
  const pieces: string[] = [];
  let current = '';
  let bytes = 0;
  let chars = 0;
  for (const character of text) {
    const size = Buffer.byteLength(character);
    const wouldOverflow = current.length > 0 && (chars >= limitChars || bytes + size > limitBytes);
    if (wouldOverflow) {
      pieces.push(current);
      current = '';
      bytes = 0;
      chars = 0;
    }
    current += character;
    bytes += size;
    chars += 1;
  }
  if (current.length > 0) {
    pieces.push(current);
  }
  return pieces;
}

export function appendTail(
  current: string,
  chunk: string,
  maxBytes = TERMINAL_TAIL_MAX_BYTES,
): string {
  if (chunk.length === 0) {
    return current;
  }
  const combined = Buffer.from(`${current}${chunk}`);
  if (combined.length <= maxBytes) {
    return combined.toString('utf8');
  }
  let start = combined.length - maxBytes;
  while (start < combined.length && (combined[start] & 0xc0) === 0x80) {
    start += 1;
  }
  return combined.subarray(start).toString('utf8');
}

export function clampText(value: string, maxChars: number): string {
  const chars = [...value];
  if (chars.length <= maxChars) {
    return value;
  }
  if (maxChars <= 1) {
    return '…';
  }
  return `${chars.slice(0, maxChars - 1).join('')}…`;
}

export function createEvent(event: RelayEvent): RelayEvent {
  return relayEventSchema.parse(event);
}

export function redactEvent(event: RelayEvent): RelayEvent {
  const redacted = relayEventSchema.parse(event);
  if (redacted.type === 'started' && redacted.payload.promptPreview !== undefined) {
    redacted.payload.promptPreview = redactSecrets(redacted.payload.promptPreview);
  }
  if (redacted.type === 'replying_to') {
    redacted.payload.replyTo = redactSecrets(redacted.payload.replyTo);
  }
  if (redacted.type === 'error') {
    redacted.payload.message = redactSecrets(redacted.payload.message);
    if (redacted.payload.tail !== undefined) {
      redacted.payload.tail = redactSecrets(redacted.payload.tail);
    }
  }
  if (redacted.type === 'output_chunk') {
    redacted.payload.text = redactSecrets(redacted.payload.text);
  }
  if (redacted.type === 'status') {
    const payload = redacted.payload;
    if (payload.state === 'working' && payload.taskPreview !== undefined) {
      payload.taskPreview = redactSecrets(payload.taskPreview);
    }
    if (payload.state === 'stuck') {
      payload.reason = redactSecrets(payload.reason);
      if (payload.tail !== undefined) {
        payload.tail = redactSecrets(payload.tail);
      }
    }
    if (payload.state === 'waiting_approval') {
      payload.summary = redactSecrets(payload.summary);
    }
    if (payload.state === 'handoff' && payload.note !== undefined) {
      payload.note = redactSecrets(payload.note);
    }
  }
  return relayEventSchema.parse(redacted);
}

export function assertRelayErrorCode(
  value: string | undefined,
  fallback: (typeof ERROR_CODES)[number],
) {
  if (value !== undefined && isRelayErrorCode(value)) {
    return value;
  }
  return fallback;
}

function readBoundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }
  if (!/^\d+$/.test(raw.trim())) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}
