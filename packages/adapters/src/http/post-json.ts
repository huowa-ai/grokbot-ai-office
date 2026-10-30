import { RelayError, redactSecrets } from '@grokbot-ai-office/core';

export interface PostJsonInput {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
  apiKey?: string;
}

export async function postJson(input: PostJsonInput): Promise<unknown> {
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(input.url, {
      method: 'POST',
      headers: input.headers,
      body: JSON.stringify(input.body),
      signal: input.signal,
    });
  } catch (error) {
    if (input.signal.aborted || isAbortError(error)) {
      throw new RelayError('TIMEOUT', '请求已中止', { cause: error });
    }
    const message = error instanceof Error ? error.message : '网络请求失败';
    throw new RelayError('HTTP_ERROR', hideSecret(message, input.apiKey), { cause: error });
  }

  if (response.status === 401 || response.status === 403) {
    throw new RelayError('AUTH_EXPIRED', `认证失败（HTTP ${response.status}）`);
  }

  const raw = await response.text();
  if (!response.ok) {
    const detail = hideSecret(raw, input.apiKey).slice(0, 500).trim();
    const message =
      detail.length > 0 ? `HTTP ${response.status} ${detail}` : `HTTP ${response.status}`;
    throw new RelayError('HTTP_ERROR', message);
  }

  if (raw.trim().length === 0) {
    throw new RelayError('EMPTY_RESPONSE', '接口返回了空内容');
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new RelayError('HTTP_ERROR', '接口返回了无法解析的内容', { cause: error });
  }
}

export function hideSecret(text: string, apiKey: string | undefined): string {
  const redacted = redactSecrets(text);
  if (apiKey === undefined || apiKey.length < 8 || !redacted.includes(apiKey)) {
    return redacted;
  }
  return redacted.split(apiKey).join('[REDACTED]');
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
