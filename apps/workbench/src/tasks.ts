import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { ProviderConfig } from '@grokbot-ai-office/registry';

import { buildRunPlan, shellQuote } from './agents.js';
import { hasSession, sessionNameFor } from './sessions.js';

export interface RunArgs {
  agent: string;
  task: string;
  file: string;
  wait: boolean;
  cwd?: string;
  timeoutSec: number;
}

export function parseRunArgs(argv: readonly string[]): RunArgs {
  const [agent, ...rest] = argv;
  if (!agent || agent.startsWith('--'))
    throw new Error('用法：run <agent> --task <slug> --file <prompt.txt> [--wait] [--cwd 目录]');
  const out: Partial<RunArgs> = { agent, wait: false, timeoutSec: 3600 };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    const value = rest[i + 1];
    const need = () => {
      if (value === undefined || value.startsWith('--')) throw new Error(`缺少 ${arg} 的值`);
      i += 1;
      return value;
    };
    if (arg === '--task') out.task = need();
    else if (arg === '--file') out.file = need();
    else if (arg === '--cwd') out.cwd = need();
    else if (arg === '--timeout') out.timeoutSec = Number(need());
    else if (arg === '--wait') out.wait = true;
    else throw new Error(`无法识别的参数：${arg}`);
  }
  if (!out.task) throw new Error('缺少 --task');
  if (!out.file) throw new Error('缺少 --file');
  sessionNameFor(agent, out.task); // 校验
  return out as RunArgs;
}

function tmux(args: string[]): void {
  const r = spawnSync('tmux', args, { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
  if (r.error) throw new Error('未找到 tmux。macOS：brew install tmux');
  if (r.status !== 0) throw new Error(`tmux 失败：${r.stderr.trim()}`);
}

export interface StartedTask {
  session: string;
  outDir: string;
}

export function startTask(
  args: RunArgs,
  provider: ProviderConfig,
  outboxRoot: string,
  self: string[],
): StartedTask {
  const plan = buildRunPlan({ agent: args.agent, task: args.task, provider, outboxRoot, self });
  if (hasSession(plan.session))
    throw new Error(`会话已存在：${plan.session}（换一个 --task，或先关闭它）`);
  mkdirSync(plan.outDir, { recursive: true });
  copyFileSync(args.file, plan.promptPath);
  for (const f of ['exit_code', 'log.txt', 'answer.txt']) {
    if (existsSync(path.join(plan.outDir, f))) writeFileSync(path.join(plan.outDir, f), '');
  }
  writeReadme(plan.outDir, args.agent, args.task, null);
  const scriptPath = path.join(plan.outDir, '.run.sh');
  writeFileSync(scriptPath, `${plan.script}\n`, { mode: 0o700 });
  tmux([
    'new-session',
    '-d',
    '-s',
    plan.session,
    '-x',
    '160',
    '-y',
    '45',
    '-c',
    args.cwd ?? process.cwd(),
    `bash ${shellQuote(scriptPath)}`,
  ]);
  return { session: plan.session, outDir: plan.outDir };
}

function writeReadme(outDir: string, agent: string, task: string, exitCode: number | null): void {
  const prompt = existsSync(path.join(outDir, 'prompt.txt'))
    ? readFileSync(path.join(outDir, 'prompt.txt'), 'utf8')
    : '';
  const status =
    exitCode === null
      ? '运行中'
      : exitCode === 0
        ? '完成（退出码 0）'
        : `失败（退出码 ${exitCode}）`;
  const lines = [
    `# ${task}`,
    '',
    `- AI：\`${agent}\``,
    `- 会话：\`${sessionNameFor(agent, task)}\``,
    `- 状态：${status}`,
    `- 时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    '',
    '## 任务',
    '',
    '```',
    prompt.trim(),
    '```',
    '',
    '回答见 `answer.txt`，完整输出（含日志）见 `log.txt`。',
    '',
  ];
  writeFileSync(path.join(outDir, 'README.md'), lines.join('\n'));
}

/** tmux 脚本结束时调用。 */
export function finishTask(outDir: string, agent: string, task: string, exitCode: number): void {
  writeReadme(outDir, agent, task, exitCode);
  writeFileSync(path.join(outDir, 'exit_code'), String(exitCode));
}

export async function waitForTask(
  outDir: string,
  timeoutSec: number,
): Promise<{ code: number; log: string }> {
  const deadline = Date.now() + timeoutSec * 1000;
  const codeFile = path.join(outDir, 'exit_code');
  while (Date.now() < deadline) {
    const raw = existsSync(codeFile) ? readFileSync(codeFile, 'utf8').trim() : '';
    if (raw !== '') {
      const logFile = path.join(outDir, 'answer.txt');
      return { code: Number(raw), log: existsSync(logFile) ? readFileSync(logFile, 'utf8') : '' };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`等待超时（${timeoutSec} 秒）；任务仍在 tmux 里运行`);
}

/** 交互式会话：gb-<agent>-interactive，并在 macOS 打开「终端」接上去。 */
export function startInteractive(
  agent: string,
  bin: string,
  cwd: string,
): { session: string; opened: boolean } {
  const session = sessionNameFor(agent, 'interactive');
  if (!hasSession(session)) {
    tmux(['new-session', '-d', '-s', session, '-c', cwd, bin]);
  }
  let opened = false;
  if (process.platform === 'darwin') {
    const cmd = `tmux attach -t ${session}`;
    const r = spawnSync('osascript', [
      '-e',
      `tell application "Terminal" to do script "${cmd}"`,
      '-e',
      'tell application "Terminal" to activate',
    ]);
    opened = r.status === 0;
  }
  return { session, opened };
}
