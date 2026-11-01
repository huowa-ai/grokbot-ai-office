import { constants, accessSync } from 'node:fs';
import path from 'node:path';

import type { ProviderConfig } from '@grokbot-ai-office/registry';

import { type SessionInfo, sessionNameFor } from './sessions.js';

export const STATUS_AGENTS = ['codex', 'grok', 'codebuddy', 'claude'] as const;

export function shellQuote(value: string): string {
  return /^[A-Za-z0-9_\/.:=@%+,-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

export function todayStamp(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export interface RunPlan {
  session: string;
  outDir: string;
  promptPath: string;
  /** tmux 里执行的 bash 脚本。 */
  script: string;
}

export interface RunPlanInput {
  agent: string;
  task: string;
  provider: ProviderConfig;
  outboxRoot: string;
  /** 结束时调用：<self...> __finish <outDir> <agent> <task> <exitCode> */
  self: string[];
  now?: Date;
}

/** 由 providers.yaml 的命令拼出在 tmux 里跑的脚本：输出 tee 到 log.txt，结束写 exit_code 和 README。 */
export function buildRunPlan(input: RunPlanInput): RunPlan {
  const { provider } = input;
  if (provider.auth !== 'subscription') {
    throw new Error(`${input.agent} 不是命令行类 AI（auth=${provider.auth}），请用 ask`);
  }
  const session = sessionNameFor(input.agent, input.task);
  const outDir = path.join(input.outboxRoot, `${todayStamp(input.now)}-${input.task}`);
  const promptPath = path.join(outDir, 'prompt.txt');
  const mode = provider.input ?? 'stdin';
  const [bin, ...rest] = provider.command;
  let argv = [bin as string, ...rest];
  let redirect = '';
  if (mode === 'file') {
    if (!rest.some((arg) => arg.includes('{file}'))) {
      throw new Error('input 为 file 时，命令里需要 {file} 占位符');
    }
    argv = argv.map((arg) => arg.replaceAll('{file}', promptPath));
    redirect = ' </dev/null';
  } else if (mode === 'stdin') {
    redirect = ` < ${shellQuote(promptPath)}`;
  }
  const cmd = argv.map(shellQuote).join(' ');
  const promptArg = mode === 'arg' ? ` "$(cat ${shellQuote(promptPath)})" </dev/null` : '';
  const log = shellQuote(path.join(outDir, 'log.txt'));
  const answer = shellQuote(path.join(outDir, 'answer.txt'));
  const finish = [...input.self, '__finish', outDir, input.agent, input.task]
    .map(shellQuote)
    .join(' ');
  const script = [
    'set -o pipefail',
    // 标准输出 = 回答（answer.txt）；标准错误只进 log.txt 和终端。
    `${cmd}${promptArg}${redirect} 2> >(tee -a ${log} >&2) | tee ${answer} | tee -a ${log}`,
    'code=$?',
    `${finish} "$code"`,
    'printf "\\n[grokbot] 完成，退出码 %s。会话保留，可关闭。\\n" "$code"',
    'exec "${SHELL:-bash}"',
  ].join('\n');
  return { session, outDir, promptPath, script };
}

export function findOnPath(bin: string, pathEnv = process.env.PATH ?? ''): string | null {
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, bin);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // 继续找
    }
  }
  return null;
}

export interface AgentStatus {
  agent: string;
  installed: boolean;
  path: string | null;
  busy: boolean;
  sessions: number;
  state: 'running' | 'done' | 'error' | 'idle' | 'missing';
}

export function agentStatuses(
  sessions: SessionInfo[],
  binFor: (agent: string) => string,
  pathEnv = process.env.PATH ?? '',
): AgentStatus[] {
  return STATUS_AGENTS.map((agent) => {
    const mine = sessions.filter((s) => s.agent === agent);
    const found = findOnPath(binFor(agent), pathEnv);
    const states = mine.map((s) => s.state ?? (s.status === 'running' ? 'running' : 'idle'));
    const state =
      found === null && mine.length === 0
        ? 'missing'
        : states.includes('running')
          ? 'running'
          : states.includes('error')
            ? 'error'
            : states.includes('done')
              ? 'done'
              : found === null
                ? 'missing'
                : 'idle';
    return {
      agent,
      state,
      installed: found !== null,
      path: found,
      busy: mine.some((s) => s.status === 'running'),
      sessions: mine.length,
    };
  });
}
