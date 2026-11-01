import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

import {
  type ProvidersFile,
  loadProvidersConfig,
  resolveProvidersPath,
} from '@grokbot-ai-office/registry';
import {
  finishTask,
  outboxRoot,
  parseRunArgs,
  startInteractive,
  startTask,
  startWorkbench,
  waitForTask,
} from '@grokbot-ai-office/workbench';

import type { RunIo } from './main.js';

type Out = (text: string) => void;

function outs(io: RunIo): { stdout: Out; stderr: Out } {
  return {
    stdout: io.stdout ?? ((t) => process.stdout.write(t.endsWith('\n') ? t : `${t}\n`)),
    stderr: io.stderr ?? ((t) => console.error(t)),
  };
}

function loadConfig(cwd: string): ProvidersFile {
  return loadProvidersConfig(resolveProvidersPath(cwd));
}

export function binFor(config: ProvidersFile | undefined, agent: string): string {
  const provider = config?.providers[agent];
  return provider && provider.auth === 'subscription' ? (provider.command[0] as string) : agent;
}

function selfArgv(): string[] {
  return [process.execPath, process.argv[1] as string];
}

export async function runWorkbenchCommand(
  argv: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  io: RunIo,
): Promise<number> {
  const { stdout, stderr } = outs(io);
  let port = Number(env.RELAY_WORKBENCH_PORT ?? 8790);
  let open = true;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--port' && /^\d+$/.test(argv[i + 1] ?? '')) {
      port = Number(argv[i + 1]);
      i += 1;
    } else if (argv[i] === '--no-open') open = false;
    else {
      stderr(`CONFIG_INVALID 无法识别的参数：${argv[i]}`);
      return 1;
    }
  }
  let config: ProvidersFile | undefined;
  try {
    config = loadConfig(cwd);
  } catch {
    config = undefined;
  }
  const publicDir = env.RELAY_WORKBENCH_DIST;
  const handle = await startWorkbench({
    port,
    outboxRoot: outboxRoot(env),
    binFor: (agent) => binFor(config, agent),
    ...(env.PATH === undefined ? {} : { pathEnv: env.PATH }),
    ...(publicDir && existsSync(publicDir) ? { publicDir } : {}),
  });
  stdout(`工作台已打开 ${handle.url}（只监听 127.0.0.1，Ctrl+C 退出）`);
  if (!handle.ptyAvailable) stderr('提示：未加载 node-pty，终端为只读预览。');
  if (open) {
    const opener =
      process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    spawn(opener, [handle.url], { stdio: 'ignore', detached: true })
      .on('error', () => {})
      .unref();
  }
  await new Promise<void>((resolve) => {
    if (io.signal) io.signal.addEventListener('abort', () => resolve(), { once: true });
    process.once('SIGINT', () => resolve());
    process.once('SIGTERM', () => resolve());
  });
  await handle.close();
  return 0;
}

export async function runTaskCommand(
  argv: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  io: RunIo,
): Promise<number> {
  const { stdout, stderr } = outs(io);
  try {
    const args = parseRunArgs(argv);
    const config = loadConfig(cwd);
    const provider = config.providers[args.agent];
    if (!provider) {
      stderr(`PROVIDER_NOT_FOUND ${args.agent} 不在 providers.yaml 里`);
      return 1;
    }
    const started = startTask(args, provider, outboxRoot(env), selfArgv());
    if (!args.wait) {
      stdout(`已在 tmux 会话 ${started.session} 中启动；产出目录 ${started.outDir}`);
      return 0;
    }
    stderr(`已启动 ${started.session}，等待完成…（产出目录 ${started.outDir}）`);
    const result = await waitForTask(started.outDir, args.timeoutSec);
    stdout(result.log.trimEnd());
    if (result.code !== 0) stderr(`TASK_FAILED 退出码 ${result.code}`);
    return result.code === 0 ? 0 : 1;
  } catch (error) {
    stderr(`CONFIG_INVALID ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

export function runFinishCommand(argv: readonly string[]): number {
  const [outDir, agent, task, code] = argv;
  if (!outDir || !agent || !task) return 1;
  finishTask(outDir, agent, task, Number(code ?? 1));
  return 0;
}

export function runTermCommand(argv: readonly string[], cwd: string, io: RunIo): number {
  const { stdout, stderr } = outs(io);
  const [agent, ...rest] = argv;
  if (!agent) {
    stderr('用法：term <agent> [--cwd 目录]');
    return 1;
  }
  const i = rest.indexOf('--cwd');
  const dir = i === -1 ? cwd : (rest[i + 1] ?? cwd);
  let config: ProvidersFile | undefined;
  try {
    config = loadConfig(cwd);
  } catch {
    config = undefined;
  }
  try {
    const r = startInteractive(agent, binFor(config, agent), dir);
    stdout(
      r.opened
        ? `已在「终端」打开 ${r.session}`
        : `会话 ${r.session} 已就绪：tmux attach -t ${r.session}`,
    );
    return 0;
  } catch (error) {
    stderr(`CONFIG_INVALID ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
