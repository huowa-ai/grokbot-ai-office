import { randomUUID } from 'node:crypto';

import { RelayError, type RelayErrorCode } from './errors.js';
import { detectWaitingApproval } from './heuristic.js';
import { redactSecrets } from './redact.js';
import {
  type RelayEvent,
  type StatusSource,
  assertRelayErrorCode,
  clampText,
  createEvent,
  parseInstance,
  previewText,
} from './schema.js';

export interface HookRequest {
  event?: string;
  instance?: string;
  summary?: string;
  taskId?: string;
  code?: string;
  reason?: string;
  tool?: string;
  message?: string;
  prompt?: string;
  notificationType?: string;
}

export type HookPlan = { action: 'ignore'; reason: string } | { action: 'emit'; event: RelayEvent };

const HOOK_STATES = {
  userpromptsubmit: 'working',
  promptsubmit: 'working',
  pretooluse: 'working',
  posttooluse: 'working',
  posttoolusefailure: 'working',
  tooluse: 'working',
  sessionstart: 'working',
  permissionrequest: 'waiting_approval',
  permission: 'waiting_approval',
  stop: 'idle',
  subagentstop: 'idle',
  sessionend: 'idle',
  idle: 'idle',
  stopfailure: 'stuck',
  error: 'stuck',
  notification: 'notification',
} as const;

export function planHook(
  input: HookRequest,
  options: { now?: () => Date; createId?: () => string } = {},
): HookPlan {
  const eventName = input.event?.trim() ?? '';
  if (eventName.length === 0) {
    throw new RelayError('CONFIG_INVALID', '缺少钩子事件名');
  }
  if (input.instance === undefined || input.instance.trim().length === 0) {
    throw new RelayError('CONFIG_INVALID', '钩子需要实例标识 provider@host');
  }
  const instance = parseInstance(input.instance.trim());
  const normalized = normalizeHookName(eventName);
  const mapped = HOOK_STATES[normalized as keyof typeof HOOK_STATES];
  if (mapped === undefined) {
    throw new RelayError('CONFIG_INVALID', `不认识的钩子事件：${eventName}`);
  }

  const summary = hookSummary(input);
  if (mapped === 'notification') {
    if (summary === undefined || detectWaitingApproval(summary) === undefined) {
      return { action: 'ignore', reason: '通知不改变状态' };
    }
  }

  const state = mapped === 'notification' ? 'waiting_approval' : mapped;
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? randomUUID;
  const source: StatusSource = 'hook';
  const taskId = input.taskId?.trim();
  const common = {
    v: 1 as const,
    id: createId(),
    ts: now().toISOString(),
    type: 'status' as const,
    instance: input.instance.trim(),
    provider: instance.provider,
    host: instance.host,
    ...(taskId === undefined || taskId.length === 0 ? {} : { taskId: taskId.slice(0, 200) }),
  };

  if (state === 'working') {
    return {
      action: 'emit',
      event: createEvent({
        ...common,
        payload: {
          state: 'working',
          source,
          ...(summary === undefined ? {} : { taskPreview: clampText(summary, 500) }),
        },
      }),
    };
  }

  if (state === 'idle') {
    return {
      action: 'emit',
      event: createEvent({
        ...common,
        payload: { state: 'idle', source },
      }),
    };
  }

  if (state === 'waiting_approval') {
    return {
      action: 'emit',
      event: createEvent({
        ...common,
        payload: {
          state: 'waiting_approval',
          source,
          approvalId: `appr_${createId()}`.slice(0, 200),
          summary: clampText(summary ?? '等待批准', 200),
        },
      }),
    };
  }

  const code: RelayErrorCode = assertRelayErrorCode(input.code, 'CLI_EXIT_NONZERO');
  const reason = clampText(redactSecrets((input.reason ?? summary ?? '钩子报告失败').trim()), 200);
  return {
    action: 'emit',
    event: createEvent({
      ...common,
      payload: {
        state: 'stuck',
        source,
        code,
        reason: reason.length > 0 ? reason : '钩子报告失败',
      },
    }),
  };
}

export function hookRequestFromUnknown(value: unknown): HookRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RelayError('CONFIG_INVALID', '钩子请求必须是 JSON 对象');
  }
  const record = value as Record<string, unknown>;
  const event = firstString(record, ['event', 'hook_event_name', 'hookEventName']);
  const instance = firstString(record, ['instance', 'provider_host']);
  const summary = firstString(record, ['summary']);
  const taskId = firstString(record, ['taskId', 'task_id', 'session_id', 'sessionId']);
  const code = firstString(record, ['code']);
  const reason = firstString(record, ['reason']);
  const tool = firstString(record, ['tool', 'tool_name', 'toolName']);
  const message = firstString(record, ['message']);
  const prompt = firstString(record, ['prompt']);
  const notificationType = firstString(record, [
    'notificationType',
    'notification_type',
    'notificationType',
  ]);
  return {
    ...(event === undefined ? {} : { event }),
    ...(instance === undefined ? {} : { instance }),
    ...(summary === undefined ? {} : { summary }),
    ...(taskId === undefined ? {} : { taskId }),
    ...(code === undefined ? {} : { code }),
    ...(reason === undefined ? {} : { reason }),
    ...(tool === undefined ? {} : { tool }),
    ...(message === undefined ? {} : { message }),
    ...(prompt === undefined ? {} : { prompt }),
    ...(notificationType === undefined ? {} : { notificationType }),
  };
}

function hookSummary(input: HookRequest): string | undefined {
  if (input.summary !== undefined && input.summary.trim().length > 0) {
    return redactSecrets(input.summary.trim());
  }
  if (input.tool !== undefined && input.tool.trim().length > 0) {
    return redactSecrets(input.tool.trim());
  }
  if (input.message !== undefined && input.message.trim().length > 0) {
    return clampText(redactSecrets(input.message.trim()), 200);
  }
  if (input.notificationType !== undefined && input.notificationType.trim().length > 0) {
    return redactSecrets(input.notificationType.trim());
  }
  if (input.prompt !== undefined && input.prompt.trim().length > 0) {
    return previewText(input.prompt, 80);
  }
  return undefined;
}

function normalizeHookName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\-\s]/g, '');
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}
