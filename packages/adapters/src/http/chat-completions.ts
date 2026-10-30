import { RelayError, redactSecrets } from '@grokbot-ai-office/core';

import { postJson } from './post-json.js';

export interface ChatCompletionInput {
  baseUrl: string;
  model: string;
  prompt: string;
  apiKey?: string;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
}

export function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  return `${trimmed}/chat/completions`;
}

export function readRequiredApiKey(keyEnv: string, env: NodeJS.ProcessEnv): string {
  const value = env[keyEnv];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new RelayError('AUTH_MISSING', `${keyEnv} 未设置`);
  }
  return value;
}

export function readOptionalApiKey(
  keyEnv: string | null | undefined,
  env: NodeJS.ProcessEnv,
): string | undefined {
  if (keyEnv === undefined || keyEnv === null || keyEnv.length === 0) {
    return undefined;
  }
  return readRequiredApiKey(keyEnv, env);
}

export async function postChatCompletions(input: ChatCompletionInput): Promise<string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (input.apiKey !== undefined) {
    headers.authorization = `Bearer ${input.apiKey}`;
  }

  const payload = await postJson({
    url: chatCompletionsUrl(input.baseUrl),
    headers,
    body: {
      model: input.model,
      messages: [{ role: 'user', content: input.prompt }],
    },
    signal: input.signal,
    fetchImpl: input.fetchImpl,
    apiKey: input.apiKey,
  });

  const text = readContent(payload);
  if (text.trim().length === 0) {
    throw new RelayError('EMPTY_RESPONSE', '接口返回了空内容');
  }
  return text;
}

export async function probeEndpoint(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; detail: string }> {
  try {
    const response = await fetchImpl(baseUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(5_000),
    });
    return { ok: true, detail: `端点可达（HTTP ${response.status}）` };
  } catch (error) {
    const message = error instanceof Error ? error.message : '无法连接';
    return { ok: false, detail: `端点不可达：${redactSecrets(message)}` };
  }
}

function readContent(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) {
    throw new RelayError('HTTP_ERROR', '接口返回了无法解析的内容');
  }
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new RelayError('EMPTY_RESPONSE', '接口返回了空内容');
  }
  const first: unknown = choices[0];
  if (typeof first !== 'object' || first === null) {
    throw new RelayError('EMPTY_RESPONSE', '接口返回了空内容');
  }
  const message = (first as { message?: unknown }).message;
  if (typeof message !== 'object' || message === null) {
    throw new RelayError('EMPTY_RESPONSE', '接口返回了空内容');
  }
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    throw new RelayError('EMPTY_RESPONSE', '接口返回了空内容');
  }
  return content.map(partText).join('');
}

function partText(part: unknown): string {
  if (typeof part === 'string') {
    return part;
  }
  if (
    typeof part === 'object' &&
    part !== null &&
    'text' in part &&
    typeof part.text === 'string'
  ) {
    return part.text;
  }
  return '';
}
