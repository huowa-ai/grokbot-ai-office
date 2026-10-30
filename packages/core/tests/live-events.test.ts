import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  type AdapterPort,
  RelayError,
  type RelayEvent,
  appendTail,
  handoff,
  listApprovals,
  planHook,
  reduceEvents,
  relay,
  requestApproval,
  resolveApproval,
} from '@grokbot-ai-office/core';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

describe('live events', () => {
  it('relay 只记录提示预览，并把输出切成带序号的块，最终回答保持原文', async () => {
    const secret = ['sk', 'supersecretvalue'].join('-');
    const prompt = `${secret}${'甲'.repeat(120)}尾部标记`;
    const answer = `${'答'.repeat(2500)}`;
    const events: RelayEvent[] = [];
    const result = await relay(
      { provider: 'codex', prompt },
      {
        hasProvider: () => true,
        host: 'mac',
        resolveAdapter: () => streamingAdapter(answer),
        events: {
          async emit(event) {
            events.push(event);
          },
        },
      },
    );

    expect(result).toMatchObject({ ok: true, text: answer });
    const encoded = JSON.stringify(events);
    expect(encoded).not.toContain(secret);
    expect(encoded).not.toContain('尾部标记');
    const started = events.find((event) => event.type === 'started');
    const preview = started?.type === 'started' ? started.payload.promptPreview : undefined;
    expect(preview).toContain('[REDACTED]');
    expect([...(preview ?? '')].length).toBeLessThanOrEqual(80);

    const chunks = events.filter((event) => event.type === 'output_chunk');
    expect(chunks.length).toBeGreaterThan(1);
    expect(
      chunks.every((event) => event.type === 'output_chunk' && event.payload.text.length <= 1024),
    ).toBe(true);
    const joined = chunks
      .map((event) => (event.type === 'output_chunk' ? event.payload.text : ''))
      .join('');
    expect(joined).toBe(answer);
    expect(chunks.map((event) => (event.type === 'output_chunk' ? event.payload.seq : 0))).toEqual(
      Array.from({ length: chunks.length }, (_, index) => index + 1),
    );
    expect(events.map((event) => event.type)).toEqual([
      'started',
      'status',
      'output_chunk',
      ...chunks.slice(1).map(() => 'output_chunk'),
      'done',
      'status',
    ]);
    expect(events.at(-1)?.type === 'status' ? events.at(-1)?.payload : undefined).toMatchObject({
      state: 'idle',
    });
  });

  it('relay 在调用失败时从 working 进入 stuck，并带上终端尾部', async () => {
    const events: RelayEvent[] = [];
    const result = await relay(
      { provider: 'codex', prompt: '你好' },
      {
        hasProvider: () => true,
        host: 'mac',
        promptPreviewChars: 0,
        resolveAdapter: () => ({
          kind: 'cli',
          async call(request) {
            await request.onOutputChunk?.('visible-tail');
            throw new RelayError('CLI_EXIT_NONZERO', '命令失败');
          },
          async selfcheck() {
            return { ok: true, detail: 'unused' };
          },
        }),
        events: {
          async emit(event) {
            events.push(event);
          },
        },
      },
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('CLI_EXIT_NONZERO');
    const statuses = events.filter((event) => event.type === 'status');
    expect(statuses.map((event) => (event.type === 'status' ? event.payload.state : ''))).toEqual([
      'working',
      'stuck',
    ]);
    const stuck = statuses[1];
    expect(stuck?.type === 'status' ? stuck.payload : undefined).toMatchObject({
      state: 'stuck',
      code: 'CLI_EXIT_NONZERO',
      tail: 'visible-tail',
    });
  });

  it('handoff 把文件复制到 outbox 并写出 handoff 事件', async () => {
    const workspace = tempDir();
    const source = path.join(workspace, 'notes.txt');
    writeFileSync(source, '交接内容');
    const events: RelayEvent[] = [];
    const result = await handoff({
      from: 'codex@mac',
      to: 'kimi@cloud',
      filePath: source,
      note: '请继续',
      workspace,
      events: {
        async emit(event) {
          events.push(event);
        },
      },
    });

    expect(result.relativePath).toBe('outbox/kimi@cloud/notes.txt');
    expect(readFileSync(result.destPath, 'utf8')).toBe('交接内容');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'status',
      instance: 'codex@mac',
      provider: 'codex',
      host: 'mac',
      payload: {
        state: 'handoff',
        from: 'codex@mac',
        to: 'kimi@cloud',
        filePath: 'outbox/kimi@cloud/notes.txt',
        note: '请继续',
      },
    });
  });

  it('requestApproval 与 resolveApproval 覆盖批准的待处理、同意和拒绝', async () => {
    const events: RelayEvent[] = [];
    const sink = {
      async emit(event: RelayEvent) {
        events.push(event);
      },
    };
    const pending = await requestApproval({
      instance: 'claude@mac',
      summary: '执行一条本地命令',
      events: sink,
    });
    expect(listApprovals(events)).toEqual([
      expect.objectContaining({
        id: pending.approvalId,
        status: 'pending',
        instance: 'claude@mac',
      }),
    ]);

    await resolveApproval({
      approvalId: pending.approvalId,
      approved: false,
      instance: 'claude@mac',
      events: sink,
    });
    expect(listApprovals(events)[0]?.status).toBe('denied');

    const again = await requestApproval({
      instance: 'claude@mac',
      summary: '第二次',
      events: sink,
    });
    await resolveApproval({
      approvalId: again.approvalId,
      approved: true,
      instance: 'claude@mac',
      events: sink,
    });
    const records = listApprovals(events);
    expect(records.map((record) => record.status)).toEqual(['denied', 'approved']);
  });

  it('planHook 把钩子映射为状态，且提示只保留短预览', () => {
    const marker = '完整提示不应出现在事件里';
    const prompt = `${'前'.repeat(90)}${marker}`;
    const working = planHook({
      event: 'UserPromptSubmit',
      instance: 'claude@mac',
      prompt,
      taskId: 'session-1',
    });
    expect(working.action).toBe('emit');
    if (working.action !== 'emit') {
      return;
    }
    expect(working.event).toMatchObject({
      instance: 'claude@mac',
      provider: 'claude',
      host: 'mac',
      taskId: 'session-1',
      payload: { state: 'working', source: 'hook' },
    });
    expect(JSON.stringify(working.event)).not.toContain(marker);

    const approval = planHook({
      event: 'PermissionRequest',
      instance: 'claude@mac',
      tool: 'Bash',
    });
    expect(approval.action === 'emit' ? approval.event.payload : undefined).toMatchObject({
      state: 'waiting_approval',
      source: 'hook',
      summary: 'Bash',
    });

    const idle = planHook({ event: 'Stop', instance: 'claude@mac' });
    expect(idle.action === 'emit' ? idle.event.payload : undefined).toMatchObject({
      state: 'idle',
      source: 'hook',
    });

    const notice = planHook({ event: 'Notification', instance: 'claude@mac', message: 'hello' });
    expect(notice).toEqual({ action: 'ignore', reason: '通知不改变状态' });
  });

  it('reduceEvents 让钩子状态优先于输出启发式', () => {
    const events: RelayEvent[] = [
      status('working', 'lifecycle'),
      status('waiting_approval', 'hook', {
        approvalId: 'appr_1',
        summary: '需要批准',
      }),
      status('working', 'heuristic', { taskPreview: 'guess' }),
    ];
    const [instance] = reduceEvents(events).instances;
    expect(instance?.status).toBe('waiting_approval');
    expect(instance?.hookActive).toBe(true);
    expect(instance?.detail).toMatchObject({ approvalId: 'appr_1' });

    events.push(status('idle', 'lifecycle'));
    const after = reduceEvents(events).instances[0];
    expect(after?.status).toBe('idle');
    expect(after?.hookActive).toBe(false);
  });

  it('appendTail 只保留最近 8KB', () => {
    const tail = appendTail('a'.repeat(100), 'b'.repeat(9000));
    expect(Buffer.byteLength(tail)).toBeLessThanOrEqual(8192);
    expect(tail.endsWith('b')).toBe(true);
    expect(tail.includes('a')).toBe(false);
  });
});

function streamingAdapter(answer: string): AdapterPort {
  return {
    kind: 'http',
    async call(request) {
      await request.onOutputChunk?.(answer);
      return answer;
    },
    async selfcheck() {
      return { ok: true, detail: 'unused' };
    },
  };
}

function status(
  state: 'working' | 'waiting_approval' | 'idle',
  source: 'lifecycle' | 'heuristic' | 'hook',
  extra: Record<string, string> = {},
): RelayEvent {
  const payload =
    state === 'waiting_approval'
      ? {
          state,
          source,
          approvalId: extra.approvalId ?? 'appr_x',
          summary: extra.summary ?? '等待批准',
        }
      : state === 'working'
        ? {
            state,
            source,
            ...(extra.taskPreview === undefined ? {} : { taskPreview: extra.taskPreview }),
          }
        : { state, source };
  return {
    v: 1,
    id: `id-${state}-${source}-${extra.approvalId ?? 'none'}`,
    ts: '2026-10-30T00:00:00.000Z',
    type: 'status',
    instance: 'claude@mac',
    provider: 'claude',
    host: 'mac',
    taskId: 'task-1',
    payload,
  };
}

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'relay-live-'));
  dirs.push(dir);
  return dir;
}
