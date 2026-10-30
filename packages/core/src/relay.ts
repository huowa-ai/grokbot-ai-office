import { randomUUID } from 'node:crypto';

import { RelayError } from './errors.js';
import type { AdapterPort, EventSink, RelayEvent, RelayRequest, RelayResult } from './ports.js';

const DEFAULT_TIMEOUT_MS = 180_000;

export interface RelayDependencies {
  hasProvider: (name: string) => boolean;
  /**
   * 注册表里的 `hosts` 是否允许当前主机。
   * 不传表示不在这里额外限制。
   */
  isAvailableOnHost?: (name: string) => boolean;
  /**
   * 调用方写在名字里的主机，例如 `codex@cloud` 的 `cloud`。
   * 与当前 `host` 不一致时直接失败，不调用适配器。
   */
  requestedHost?: string;
  resolveAdapter?: (name: string) => AdapterPort | undefined;
  events?: EventSink;
  host?: string;
  createRequestId?: () => string;
  now?: () => number;
}

export const noopEventSink: EventSink = {
  emit(): Promise<void> {
    return Promise.resolve();
  },
};

export async function relay(
  request: RelayRequest,
  dependencies: RelayDependencies,
): Promise<RelayResult> {
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  const currentHost = dependencies.host ?? '';
  const requestedHost = dependencies.requestedHost;

  if (requestedHost !== undefined && requestedHost.length > 0 && requestedHost !== currentHost) {
    const message =
      currentHost.length === 0
        ? `实例标识指定了主机 ${requestedHost}，但未设置 RELAY_HOST`
        : `实例标识的主机 ${requestedHost} 与当前 RELAY_HOST ${currentHost} 不一致`;
    return failure(new RelayError('CONFIG_INVALID', message), startedAt, now);
  }

  if (!dependencies.hasProvider(request.provider)) {
    return failure(
      new RelayError('PROVIDER_NOT_FOUND', `未找到提供者：${request.provider}`),
      startedAt,
      now,
    );
  }

  if (dependencies.isAvailableOnHost && !dependencies.isAvailableOnHost(request.provider)) {
    const message =
      currentHost.length === 0
        ? `提供者 ${request.provider} 限定了主机，但未设置 RELAY_HOST`
        : `提供者 ${request.provider} 在主机 ${currentHost} 上不可用`;
    return failure(new RelayError('CONFIG_INVALID', message), startedAt, now);
  }

  const requestId = dependencies.createRequestId?.() ?? `r_${randomUUID()}`;
  const sink = dependencies.events ?? noopEventSink;

  const publish = async (
    type: RelayEvent['type'],
    extra?: Pick<RelayEvent, 'replyTo' | 'durationMs' | 'error'>,
  ): Promise<void> => {
    const event: RelayEvent = {
      v: 1,
      id: randomUUID(),
      ts: new Date(now()).toISOString(),
      provider: request.provider,
      host: currentHost,
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
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new RelayError('TIMEOUT', `调用超过 ${timeoutMs} 毫秒`));
    }, timeoutMs);
  });
  void timeoutPromise.catch(() => {
    // 超时与适配器谁先结束都可能留下另一个拒绝，这里避免未处理的拒绝。
  });

  try {
    const callPromise = adapter.call(request, controller.signal);
    void callPromise.catch(() => {
      // 同上：超时胜出时，适配器稍后的拒绝不能变成未处理拒绝。
    });
    const text = await Promise.race([callPromise, timeoutPromise]);
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
    const relayError = asRelayError(error, controller.signal.aborted, timeoutMs);
    if (!relayError) {
      throw error;
    }
    await publish('error', {
      durationMs,
      error: { code: relayError.code, message: relayError.message },
    });
    return { ok: false, error: relayError, durationMs };
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

function failure(error: RelayError, startedAt: number, now: () => number): RelayResult {
  return { ok: false, error, durationMs: elapsed(startedAt, now) };
}

function asRelayError(error: unknown, aborted: boolean, timeoutMs: number): RelayError | undefined {
  if (aborted) {
    return new RelayError('TIMEOUT', `调用超过 ${timeoutMs} 毫秒`, { cause: error });
  }
  if (error instanceof RelayError) {
    return error;
  }
  return undefined;
}

function elapsed(startedAt: number, now: () => number): number {
  return Math.max(0, now() - startedAt);
}
