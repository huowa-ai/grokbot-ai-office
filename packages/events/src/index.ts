import * as os from 'node:os';
import * as path from 'node:path';

export const EVENT_TYPES = ['started', 'replying_to', 'done', 'error'] as const;

export type StatusEventType = (typeof EVENT_TYPES)[number];

export interface StatusEvent {
  v: 1;
  id: string;
  ts: string;
  provider: string;
  type: StatusEventType;
  requestId: string;
  replyTo?: string;
  durationMs?: number;
  error?: {
    code: string;
    message: string;
  };
}

export function defaultEventsPath(homeDirectory = os.homedir()): string {
  return path.join(homeDirectory, '.grokbot-ai-office', 'events.jsonl');
}

export function resolveEventsPath(
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory = os.homedir(),
): string {
  const override = env.RELAY_EVENTS_PATH;
  if (typeof override === 'string' && override.trim().length > 0) {
    return override;
  }
  return defaultEventsPath(homeDirectory);
}
