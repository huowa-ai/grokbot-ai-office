import type { ClientEvent } from './events.js';

export interface DemoCue {
  atMs: number;
  event: ClientEvent;
}

const T0 = '2026-10-30T09:00:00.000Z';

export function demoScript(): DemoCue[] {
  seq = 0;
  const cues: DemoCue[] = [];
  const push = (atMs: number, event: ClientEvent): void => {
    cues.push({ atMs, event });
  };

  boot(push, 0, 'codex', 'mac', 'working', '整理会议纪要');
  chunk(
    push,
    0,
    'codex',
    'mac',
    1,
    '\u001b[1;36m本地 Codex\u001b[0m\r\n\u001b[32m✓\u001b[0m 正在整理纪要\r\n',
  );
  boot(push, 0, 'codex', 'cloud', 'idle');
  boot(push, 0, 'claude', 'mac', 'idle');
  boot(push, 0, 'gemini', 'cloud', 'working', '对照两份草稿');
  chunk(push, 0, 'gemini', 'cloud', 1, '\u001b[34m★\u001b[0m \u001b[35m双子对照\u001b[0m\r\n');
  boot(push, 0, 'codebuddy', 'mac', 'waiting_approval', undefined, {
    approvalId: 'appr_demo',
    summary: '允许读取仓库',
  });
  boot(push, 0, 'hermes', 'cloud', 'idle');
  boot(push, 0, 'openclaw', 'mac', 'idle');
  boot(push, 0, 'deepseek', 'cloud', 'working', '下潜检索');
  chunk(push, 0, 'deepseek', 'cloud', 1, '\u001b[34mwhale\u001b[0m 检索中\r\n');
  boot(push, 0, 'kimi', 'mac', 'working', '补一页摘要');
  chunk(push, 0, 'kimi', 'mac', 1, 'kimi > 摘要写到一半\r\n');

  chunk(push, 900, 'codex', 'mac', 2, '议题：办公室装修\r\n');
  chunk(push, 1400, 'gemini', 'cloud', 2, '左稿偏短，右稿保留了例子\r\n');

  push(
    1800,
    status('hermes', 'cloud', 'handoff', {
      from: 'hermes@cloud',
      to: 'openclaw@mac',
      filePath: 'outbox/openclaw@mac/notes.txt',
      note: '请继续',
    }),
  );

  push(
    2600,
    status('deepseek', 'cloud', 'stuck', {
      code: 'HTTP_ERROR',
      reason: '上游没有返回',
    }),
  );
  chunk(push, 2600, 'deepseek', 'cloud', 2, '\u001b[31m连接中断\u001b[0m\r\n');

  boot(push, 4200, 'glm', 'cloud', 'idle');
  boot(push, 4800, 'workbuddy', 'mac', 'working', '对着耳机念草稿');
  chunk(push, 4800, 'workbuddy', 'mac', 1, '\u001b[32mheadset\u001b[0m 录音开始\r\n');

  return cues;
}

export function demoDurationMs(script: readonly DemoCue[] = demoScript()): number {
  const last = script.reduce((max, cue) => Math.max(max, cue.atMs), 0);
  return last + 7000;
}

export function cuesUntil(
  script: readonly DemoCue[],
  elapsedMs: number,
  cursor: number,
): { events: ClientEvent[]; cursor: number } {
  let index = cursor;
  const events: ClientEvent[] = [];
  while (index < script.length) {
    const cue = script[index];
    if (!cue || cue.atMs > elapsedMs) {
      break;
    }
    events.push(cue.event);
    index += 1;
  }
  return { events, cursor: index };
}

function boot(
  push: (atMs: number, event: ClientEvent) => void,
  atMs: number,
  provider: string,
  host: string,
  kind: 'working' | 'idle' | 'waiting_approval',
  taskPreview?: string,
  approval?: { approvalId: string; summary: string },
): void {
  push(atMs, started(provider, host, taskPreview));
  if (kind === 'working') {
    push(atMs, status(provider, host, 'working', taskPreview ? { taskPreview } : {}));
    return;
  }
  if (kind === 'waiting_approval' && approval) {
    push(atMs, status(provider, host, 'waiting_approval', approval, 'hook'));
    return;
  }
  push(atMs, status(provider, host, 'idle'));
}

function started(provider: string, host: string, preview?: string): ClientEvent {
  return event(provider, host, 'started', preview ? { promptPreview: preview } : {});
}

function chunk(
  push: (atMs: number, event: ClientEvent) => void,
  atMs: number,
  provider: string,
  host: string,
  seq: number,
  text: string,
): void {
  push(atMs, event(provider, host, 'output_chunk', { seq, text }));
}

function status(
  provider: string,
  host: string,
  state: string,
  extra: Record<string, unknown> = {},
  source = 'lifecycle',
): ClientEvent {
  return event(provider, host, 'status', { state, source, ...extra });
}

let seq = 0;

function event(
  provider: string,
  host: string,
  type: ClientEvent['type'],
  payload: Record<string, unknown>,
): ClientEvent {
  seq += 1;
  return {
    v: 1,
    id: `demo_${provider}_${host}_${type}_${seq}`,
    ts: T0,
    type,
    instance: `${provider}@${host}`,
    provider,
    host,
    taskId: `task_${provider}_${host}`,
    payload,
  };
}
