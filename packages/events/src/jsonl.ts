import { mkdir, open, readFile } from 'node:fs/promises';
import * as path from 'node:path';

import {
  type EventSink,
  RelayError,
  type RelayEvent,
  redactEvent,
  relayEventSchema,
} from '@grokbot-ai-office/core';

const writers = new Map<string, Promise<void>>();

export function createJsonlEventSink(filePath: string): EventSink {
  return {
    async emit(event: RelayEvent): Promise<void> {
      let redacted: RelayEvent;
      try {
        redacted = redactEvent(event);
      } catch (error) {
        throw new RelayError('CONFIG_INVALID', '事件不符合 v1 结构', { cause: error });
      }
      const line = `${JSON.stringify(redacted)}\n`;
      await enqueue(filePath, () => appendLine(filePath, line));
    },
  };
}

export async function readEvents(filePath: string): Promise<RelayEvent[]> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    if (readCode(error) === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const events: RelayEvent[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(trimmed);
      const result = relayEventSchema.safeParse(parsed);
      if (result.success) {
        events.push(result.data);
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        continue;
      }
      throw error;
    }
  }
  return events;
}

function enqueue(filePath: string, task: () => Promise<void>): Promise<void> {
  const previous = writers.get(filePath) ?? Promise.resolve();
  const run = previous.then(task);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  writers.set(filePath, settled);
  return run;
}

async function appendLine(filePath: string, line: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const handle = await open(filePath, 'a');
  try {
    await handle.write(line);
  } finally {
    await handle.close();
  }
}

function readCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = error.code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}
