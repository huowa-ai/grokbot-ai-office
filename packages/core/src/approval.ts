import { randomUUID } from 'node:crypto';

import { RelayError } from './errors.js';
import type { EventSink } from './ports.js';
import { redactSecrets } from './redact.js';
import { type RelayEvent, clampText, createEvent, parseInstance } from './schema.js';

export interface ApprovalRecord {
  id: string;
  instance: string;
  summary: string;
  status: 'pending' | 'approved' | 'denied';
  ts: string;
}

export interface RequestApprovalInput {
  instance: string;
  summary: string;
  events: EventSink;
  taskId?: string;
  now?: () => Date;
  createId?: () => string;
}

export interface ResolveApprovalInput {
  approvalId: string;
  approved: boolean;
  instance: string;
  events: EventSink;
  taskId?: string;
  now?: () => Date;
  createId?: () => string;
}

export async function requestApproval(
  input: RequestApprovalInput,
): Promise<{ approvalId: string }> {
  const parsed = parseInstance(input.instance);
  const summary = clampText(redactSecrets(input.summary.trim()), 200);
  if (summary.length === 0) {
    throw new RelayError('CONFIG_INVALID', '批准摘要不能为空');
  }
  const createId = input.createId ?? randomUUID;
  const approvalId = `appr_${createId()}`.slice(0, 200);
  const now = input.now ?? (() => new Date());
  await input.events.emit(
    createEvent({
      v: 1,
      id: createId(),
      ts: now().toISOString(),
      type: 'status',
      instance: input.instance,
      provider: parsed.provider,
      host: parsed.host,
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
      payload: {
        state: 'waiting_approval',
        source: 'lifecycle',
        approvalId,
        summary,
      },
    }),
  );
  return { approvalId };
}

export async function resolveApproval(input: ResolveApprovalInput): Promise<void> {
  const parsed = parseInstance(input.instance);
  if (input.approvalId.trim().length === 0) {
    throw new RelayError('CONFIG_INVALID', '缺少批准 id');
  }
  const createId = input.createId ?? randomUUID;
  const now = input.now ?? (() => new Date());
  await input.events.emit(
    createEvent({
      v: 1,
      id: createId(),
      ts: now().toISOString(),
      type: 'status',
      instance: input.instance,
      provider: parsed.provider,
      host: parsed.host,
      taskId: input.taskId ?? input.approvalId,
      payload: {
        state: 'idle',
        source: 'lifecycle',
        approvalId: input.approvalId,
        approved: input.approved,
      },
    }),
  );
}

export function listApprovals(events: readonly RelayEvent[]): ApprovalRecord[] {
  const records = new Map<string, ApprovalRecord>();
  for (const event of events) {
    if (event.type !== 'status') {
      continue;
    }
    const payload = event.payload;
    if (payload.state === 'waiting_approval') {
      records.set(payload.approvalId, {
        id: payload.approvalId,
        instance: event.instance,
        summary: payload.summary,
        status: 'pending',
        ts: event.ts,
      });
      continue;
    }
    if (
      payload.state === 'idle' &&
      payload.approvalId !== undefined &&
      payload.approved !== undefined
    ) {
      const existing = records.get(payload.approvalId);
      if (existing) {
        existing.status = payload.approved ? 'approved' : 'denied';
      }
    }
  }
  return [...records.values()];
}
