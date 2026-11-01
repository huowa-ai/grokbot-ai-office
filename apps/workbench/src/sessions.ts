import { execFileSync } from 'node:child_process';

export const SESSION_PREFIX = 'gb-';
const SHELLS = new Set(['bash', 'zsh', 'sh', 'fish', 'dash', 'login', 'tmux']);

export interface SessionName {
  name: string;
  agent: string;
  task: string;
}

export type SessionState = 'running' | 'idle' | 'done' | 'error';

export interface SessionInfo extends SessionName {
  status: 'running' | 'idle';
  /** 带上产出箱 exit_code 的状态：running / done / error / idle。 */
  state?: SessionState;
  command: string;
  created: number;
}

/** gb-<agent>-<task-slug>。agent 不含连字符；task 可以含。 */
export function parseSessionName(name: string): SessionName | undefined {
  const match = /^gb-([a-z0-9]+)-([a-z0-9][a-z0-9-]*)$/.exec(name);
  if (match === null) {
    return undefined;
  }
  return { name, agent: match[1] as string, task: match[2] as string };
}

export function sessionNameFor(agent: string, task: string): string {
  const name = `${SESSION_PREFIX}${agent}-${task}`;
  if (parseSessionName(name) === undefined) {
    throw new Error(
      `会话名不合法：${name}（agent 只能是小写字母数字，task 用小写字母数字和连字符）`,
    );
  }
  return name;
}

export function isShellCommand(command: string): boolean {
  return SHELLS.has(command.replace(/^-/, '').trim());
}

export type Exec = (file: string, args: string[]) => string;

export const defaultExec: Exec = (file, args) =>
  execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/**
 * 解析 `tmux list-panes -a -F '#{session_name}\t#{pane_current_command}\t#{session_created}\t#{pane_pid}'`。
 * 前台是 shell 时，再看 shell 有没有子进程（比如 bash -c 循环里的 sleep）。
 */
export function parsePaneList(
  output: string,
  hasChildren: (pid: number) => boolean = () => false,
): SessionInfo[] {
  const bySession = new Map<string, SessionInfo>();
  for (const line of output.split('\n')) {
    const [name, command = '', created = '0', pid = '0'] = line.split('\t');
    if (!name) {
      continue;
    }
    const parsed = parseSessionName(name);
    if (parsed === undefined) {
      continue;
    }
    const running = !isShellCommand(command) || (Number(pid) > 0 && hasChildren(Number(pid)));
    const existing = bySession.get(name);
    if (existing === undefined) {
      bySession.set(name, {
        ...parsed,
        status: running ? 'running' : 'idle',
        command,
        created: Number(created) || 0,
      });
    } else if (running) {
      existing.status = 'running';
      existing.command = command;
    }
  }
  return [...bySession.values()].sort((a, b) => b.created - a.created);
}

export function listSessions(exec: Exec = defaultExec): SessionInfo[] {
  try {
    return parsePaneList(
      exec('tmux', [
        'list-panes',
        '-a',
        '-F',
        '#{session_name}\t#{pane_current_command}\t#{session_created}\t#{pane_pid}',
      ]),
      (pid) => {
        try {
          return exec('pgrep', ['-P', String(pid)]).trim().length > 0;
        } catch {
          return false; // pgrep 没找到子进程时退出码为 1
        }
      },
    );
  } catch {
    return []; // 没有 tmux 服务或没装 tmux
  }
}

export function capturePane(name: string, exec: Exec = defaultExec): string {
  return exec('tmux', ['capture-pane', '-p', '-e', '-J', '-S', '-200', '-t', `=${name}:`]);
}

export function killSession(name: string, exec: Exec = defaultExec): void {
  if (parseSessionName(name) === undefined) {
    throw new Error('只能关闭 gb- 开头的会话');
  }
  exec('tmux', ['kill-session', '-t', `=${name}`]);
}

export function hasSession(name: string, exec: Exec = defaultExec): boolean {
  try {
    exec('tmux', ['has-session', '-t', `=${name}`]);
    return true;
  } catch {
    return false;
  }
}

export function sessionState(status: SessionInfo['status'], exitCode: number | null): SessionState {
  if (status === 'running') return 'running';
  if (exitCode === null) return 'idle';
  return exitCode === 0 ? 'done' : 'error';
}
