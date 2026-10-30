import { randomUUID } from 'node:crypto';

import { RelayError } from './errors.js';
import type { AdapterPort, EventSink, RelayEvent, RelayRequest, RelayResult } from './ports.js';

const DEFAULT_TIMEOUT_MS = 180_000;

export interface RelayDependencies {
  hasProvider: (name: string) => boolean;
  resolveAdapter?: (name: string) => AdapterPort | undefined;
  events?: EventSink;
  createRequestId?: () => string;
  now?: () => number;
}

export async function relay(
  request: RelayRequest,
  dependencies: RelayDependencies,
): Promise<RelayResult> {
  const now = dependencies.now ?? Date.now;
  const startedAt = now();

  if (!dependencies.hasProvider(request.provider)) {
    return {
      ok: false,
      error: new RelayError('PROVIDER_NOT_FOUND', `未找到提供者：${request.provider}`),
      durationMs: elapsed(startedAt, now),
    };
  }

  const requestId = dependencies.createRequestId?.() ?? `r_${randomUUID()}`;
  const sink = dependencies.events;

  const publish = async (
    type: RelayEvent['type'],
    extra?: Pick<RelayEvent, 'replyTo' | 'durationMs' | 'error'>,
  ): Promise<void> => {
    if (!sink) {
      return;
    }
    const event: RelayEvent = {
      v: 1,
      id: randomUUID(),
      ts: new Date(now()).toISOString(),
      provider: request.provider,
      type,
      requestId,
    };
    if (extra?.replyTo !== undefined) {
      event.replyTo = extra.replyTo;
    }
    if (extra?.durationMs !== undefined) {
      event.durationMs = extra.durationMs;
    }
    if (extra?.error !== undefined) {
      event.error = extra.error;
    }
    await sink.emit(event);
  };

  await publish('started');
  if (request.replyTo !== undefined) {
    await publish('replying_to', { replyTo: request.replyTo });
  }

  if (!dependencies.resolveAdapter) {
    throw new RelayError('CONFIG_INVALID', '未注入适配器', { isOperational: false });
  }

  const adapter = dependencies.resolveAdapter(request.provider);
  if (!adapter) {
    throw new RelayError('CONFIG_INVALID', `提供者 ${request.provider} 没有适配器`, {
      isOperational: false,
    });
  }

  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const text = await adapter.call(request, controller.signal);
    const durationMs = elapsed(startedAt, now);
    if (text.trim().length === 0) {
      const error = new RelayError('EMPTY_RESPONSE', '适配器返回了空响应');
      await publish('error', {
        durationMs,
        error: { code: error.code, message: error.message },
      });
      return { ok: false, error, durationMs };
    }

    await publish('done', { durationMs });
    return { ok: true, text, durationMs };
  } catch (error) {
    const durationMs = elapsed(startedAt, now);
    if (controller.signal.aborted) {
      const relayError = new RelayError('TIMEOUT', `调用超过 ${timeoutMs} 毫秒`, {
        cause: error,
      });
      await publish('error', {
        durationMs,
        error: { code: relayError.code, message: relayError.message },
      });
      return { ok: false, error: relayError, durationMs };
    }

    if (error instanceof RelayError) {
      await publish('error', {
        durationMs,
        error: { code: error.code, message: error.message },
      });
      return { ok: false, error, durationMs };
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function elapsed(startedAt: number, now: () => number): number {
  return Math.max(0, now() - startedAt);
}
