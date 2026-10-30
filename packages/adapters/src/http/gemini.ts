import { RelayError } from '@grokbot-ai-office/core';

import { postJson } from './post-json.js';

export const GEMINI_API_ORIGIN = 'https://generativelanguage.googleapis.com';

export interface GeminiInput {
  model: string;
  prompt: string;
  apiKey: string;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
}

export function geminiGenerateUrl(model: string): string {
  return `${GEMINI_API_ORIGIN}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

export async function postGeminiGenerate(input: GeminiInput): Promise<string> {
  const url = geminiGenerateUrl(input.model);
  if (url.includes(input.apiKey) || url.includes('key=')) {
    throw new RelayError('CONFIG_INVALID', 'Gemini 请求不能把密钥放进 URL');
  }
  const payload = await postJson({
    url,
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': input.apiKey,
    },
    body: {
      contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
    },
    signal: input.signal,
    fetchImpl: input.fetchImpl,
    apiKey: input.apiKey,
  });
  return readGeminiText(payload);
}

function readGeminiText(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) {
    throw new RelayError('HTTP_ERROR', '接口返回了无法解析的内容');
  }
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new RelayError('EMPTY_RESPONSE', '接口返回了空内容');
  }
  const first: unknown = candidates[0];
  if (typeof first !== 'object' || first === null) {
    throw new RelayError('EMPTY_RESPONSE', '接口返回了空内容');
  }
  const content = (first as { content?: unknown }).content;
  if (typeof content !== 'object' || content === null) {
    throw new RelayError('EMPTY_RESPONSE', '接口返回了空内容');
  }
  const parts = (content as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) {
    throw new RelayError('EMPTY_RESPONSE', '接口返回了空内容');
  }
  const text = parts.map(partText).join('');
  if (text.trim().length === 0) {
    throw new RelayError('EMPTY_RESPONSE', '接口返回了空内容');
  }
  return text;
}

function partText(part: unknown): string {
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
