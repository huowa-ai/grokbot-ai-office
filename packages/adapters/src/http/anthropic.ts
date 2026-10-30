import { RelayError } from '@grokbot-ai-office/core';

import { postJson } from './post-json.js';

export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';
export const ANTHROPIC_MAX_TOKENS = 4096;

export interface AnthropicInput {
  model: string;
  prompt: string;
  apiKey: string;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
}

export async function postAnthropicMessage(input: AnthropicInput): Promise<string> {
  const payload = await postJson({
    url: ANTHROPIC_MESSAGES_URL,
    headers: {
      'content-type': 'application/json',
      'x-api-key': input.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: {
      model: input.model,
      max_tokens: ANTHROPIC_MAX_TOKENS,
      messages: [{ role: 'user', content: input.prompt }],
    },
    signal: input.signal,
    fetchImpl: input.fetchImpl,
    apiKey: input.apiKey,
  });
  return readAnthropicText(payload);
}

function readAnthropicText(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) {
    throw new RelayError('HTTP_ERROR', '接口返回了无法解析的内容');
  }
  const content = (payload as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    throw new RelayError('EMPTY_RESPONSE', '接口返回了空内容');
  }
  const text = content.map(blockText).join('');
  if (text.trim().length === 0) {
    throw new RelayError('EMPTY_RESPONSE', '接口返回了空内容');
  }
  return text;
}

function blockText(block: unknown): string {
  if (typeof block !== 'object' || block === null || !('text' in block)) {
    return '';
  }
  if (typeof block.text !== 'string') {
    return '';
  }
  if ('type' in block && block.type !== 'text') {
    return '';
  }
  return block.text;
}
