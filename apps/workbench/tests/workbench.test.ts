import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  agentStatuses,
  buildRunPlan,
  listOutbox,
  parsePaneList,
  parseRunArgs,
  parseSessionName,
  readOutboxFile,
  renderMarkdown,
  sessionNameFor,
  sessionState,
  taskExitCode,
} from '../src/index.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'wb-'));
  dirs.push(d);
  return d;
}

describe('session names', () => {
  it('解析 gb-<agent>-<task>', () => {
    expect(parseSessionName('gb-codex-unit-tests')).toEqual({
      name: 'gb-codex-unit-tests',
      agent: 'codex',
      task: 'unit-tests',
    });
    expect(parseSessionName('gb-grok-interactive')?.agent).toBe('grok');
    expect(parseSessionName('codex-x')).toBeUndefined();
    expect(parseSessionName('gb-codex')).toBeUndefined();
    expect(parseSessionName('gb-Codex-x')).toBeUndefined();
    expect(() => sessionNameFor('codex', 'bad slug')).toThrow();
  });

  it('pane 列表：非 shell 进程算运行中，只保留 gb- 会话，新的在前', () => {
    const out = [
      'gb-codex-a\tzsh\t100',
      'gb-codex-a\tnode\t100',
      'gb-grok-b\t-bash\t200',
      'work\tvim\t300',
      '',
    ].join('\n');
    const list = parsePaneList(out);
    expect(list.map((s) => [s.name, s.status])).toEqual([
      ['gb-grok-b', 'idle'],
      ['gb-codex-a', 'running'],
    ]);
    const loop = parsePaneList('gb-codebuddy-r\tbash\t1\t42\ngb-grok-x\tzsh\t1\t43', (pid) => pid === 42);
    expect(loop.map((s) => s.status)).toEqual(['running', 'idle']);
  });

  it('状态：运行中优先，其次看 exit_code', () => {
    expect(sessionState('running', 1)).toBe('running');
    expect(sessionState('idle', 0)).toBe('done');
    expect(sessionState('idle', 2)).toBe('error');
    expect(sessionState('idle', null)).toBe('idle');
  });

  it('agentStatuses 汇总每个 AI 的圆点颜色', () => {
    const bin = tmp();
    writeFileSync(path.join(bin, 'codex'), '#!/bin/sh\n', { mode: 0o755 });
    const st = agentStatuses(
      [
        {
          name: 'gb-codex-a',
          agent: 'codex',
          task: 'a',
          status: 'idle',
          state: 'error',
          command: 'zsh',
          created: 1,
        },
      ],
      (a) => a,
      bin,
    );
    expect(Object.fromEntries(st.map((s) => [s.agent, s.state]))).toEqual({
      codex: 'error',
      grok: 'missing',
      codebuddy: 'missing',
      claude: 'missing',
    });
  });
});

describe('outbox', () => {
  it('新的在前，读 README 和文件列表，拒绝越界路径', () => {
    const root = tmp();
    mkdirSync(path.join(root, '2026-10-30-old'));
    mkdirSync(path.join(root, '2026-11-01-new', 'sub'), { recursive: true });
    writeFileSync(path.join(root, '2026-11-01-new', 'README.md'), '# 新任务');
    writeFileSync(path.join(root, '2026-11-01-new', 'sub', 'a.txt'), 'hello');
    writeFileSync(path.join(root, '2026-11-01-new', 'exit_code'), '0');
    utimesSync(path.join(root, '2026-10-30-old'), new Date(), new Date());
    const list = listOutbox(root);
    expect(list.map((e) => e.folder)).toEqual(['2026-11-01-new', '2026-10-30-old']);
    expect(list[0]?.readme).toBe('# 新任务');
    expect(list[0]?.files.map((f) => f.name)).toEqual(['exit_code', 'README.md', 'sub/a.txt']);
    expect(readOutboxFile(root, '2026-11-01-new', 'sub/a.txt')).toBe('hello');
    expect(() => readOutboxFile(root, '2026-11-01-new', '../../etc/passwd')).toThrow();
    expect(() => readOutboxFile(root, '..', 'x')).toThrow();
    expect(taskExitCode(root, 'new')).toBe(0);
    expect(taskExitCode(root, 'old')).toBeNull();
    expect(listOutbox(path.join(root, 'none'))).toEqual([]);
  });

  it('Markdown 转义 HTML', () => {
    const html = renderMarkdown('# 标题\n\n<script>x</script>\n\n- `a`\n\n```\n<b>\n```');
    expect(html).toContain('<h1>标题</h1>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('<li><code>a</code></li>');
    expect(html).toContain('&#60;b&#62;');
  });
});

describe('run', () => {
  it('解析参数', () => {
    expect(
      parseRunArgs(['codex', '--task', 'unit-tests', '--file', 'p.txt', '--wait']),
    ).toMatchObject({
      agent: 'codex',
      task: 'unit-tests',
      file: 'p.txt',
      wait: true,
    });
    expect(() => parseRunArgs(['codex', '--file', 'p.txt'])).toThrow('--task');
    expect(() => parseRunArgs(['codex', '--task', 'Bad Slug', '--file', 'p'])).toThrow();
  });

  const base = {
    task: 'demo',
    outboxRoot: '/o',
    self: ['/node', '/cli.js'],
    now: new Date(2026, 10, 1),
  };

  it('stdin 模式：提示从 prompt.txt 重定向，输出 tee 到 log.txt', () => {
    const plan = buildRunPlan({
      ...base,
      agent: 'codex',
      provider: {
        auth: 'subscription',
        command: ['codex', 'exec', '--dangerously-bypass-approvals-and-sandbox', '-'],
        input: 'stdin',
        safe_mode: 'x',
      },
    });
    expect(plan.session).toBe('gb-codex-demo');
    expect(plan.outDir).toBe('/o/2026-11-01-demo');
    expect(plan.script).toContain(
      'codex exec --dangerously-bypass-approvals-and-sandbox - < /o/2026-11-01-demo/prompt.txt 2> >(tee -a /o/2026-11-01-demo/log.txt >&2) | tee /o/2026-11-01-demo/answer.txt',
    );
    expect(plan.script).toContain('/node /cli.js __finish /o/2026-11-01-demo codex demo "$code"');
  });

  it('file 和 arg 模式', () => {
    const file = buildRunPlan({
      ...base,
      agent: 'grok',
      provider: {
        auth: 'subscription',
        command: ['grok', '--prompt-file', '{file}'],
        input: 'file',
        safe_mode: 'x',
      },
    });
    expect(file.script).toContain('grok --prompt-file /o/2026-11-01-demo/prompt.txt </dev/null');
    const arg = buildRunPlan({
      ...base,
      agent: 'codebuddy',
      provider: {
        auth: 'subscription',
        command: ['codebuddy', '-p'],
        input: 'arg',
        safe_mode: 'x',
      },
    });
    expect(arg.script).toContain('codebuddy -p "$(cat /o/2026-11-01-demo/prompt.txt)" </dev/null');
    expect(() =>
      buildRunPlan({
        ...base,
        agent: 'deepseek',
        provider: { auth: 'api_key', key_env: 'K' } as never,
      }),
    ).toThrow('ask');
  });
});
