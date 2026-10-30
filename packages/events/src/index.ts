import * as os from 'node:os';
import * as path from 'node:path';

export { EVENT_TYPES, relayEventSchema } from '@grokbot-ai-office/core';
export type {
  RelayEvent,
  RelayEvent as StatusEvent,
  RelayEventType,
} from '@grokbot-ai-office/core';

export { createJsonlEventSink, readEvents } from './jsonl.js';

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
