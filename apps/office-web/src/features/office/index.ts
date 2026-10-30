import { resolveEventsPath } from '@grokbot-ai-office/events';

export interface OfficeStatus {
  mode: 'read-only';
  eventsPath: string;
}

export function officeStatus(env: NodeJS.ProcessEnv = process.env): OfficeStatus {
  return {
    mode: 'read-only',
    eventsPath: resolveEventsPath(env),
  };
}
