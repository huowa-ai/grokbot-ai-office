import type { AdapterRuntime, PtyProcess, PtySpawn } from '../types.js';
import { killProcessTree } from './kill-tree.js';
import { type ChildResult, type ProcessRunOptions, runChild } from './run-process.js';

interface NodePtyModule {
  spawn?: PtySpawn;
}

const loggedFallbacks = new Set<string>();
let cachedPty: Promise<PtySpawn | undefined> | undefined;

export async function runSubscriptionProcess(
  bin: string,
  args: string[],
  options: ProcessRunOptions,
  runtime: AdapterRuntime,
  providerName: string,
  usePty: boolean,
): Promise<ChildResult> {
  if (!usePty) {
    return runChild(bin, args, options);
  }
  const resolved = await resolvePty(runtime);
  if (!resolved.ok) {
    logFallback(providerName, resolved.reason, runtime.log);
    return runChild(bin, args, options);
  }
  return runPty(resolved.spawn, bin, args, options);
}

export function runPty(
  spawnPty: PtySpawn,
  bin: string,
  args: string[],
  options: ProcessRunOptions,
): Promise<ChildResult> {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = '';
    let chunkError: Error | undefined;
    let chain = Promise.resolve();
    const killTree = options.killTree ?? killProcessTree;
    const finish = (result: ChildResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    let proc: PtyProcess;
    try {
      const env = envRecord(options.env);
      if (env.TERM === undefined) {
        env.TERM = 'xterm-256color';
      }
      proc = spawnPty(bin, args, {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: options.cwd,
        env,
      });
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error('伪终端启动失败');
      finish({
        stdout: '',
        stderr: '',
        exitCode: null,
        error: normalized,
        errorCode: readErrorCode(error),
        abort: options.signal.aborted,
      });
      return;
    }

    const stop = (): void => {
      try {
        killTree(proc.pid);
      } catch (error) {
        if (chunkError === undefined && error instanceof Error) {
          chunkError = error;
        }
      }
      try {
        proc.kill('SIGKILL');
      } catch (error) {
        if (!isGone(error) && chunkError === undefined && error instanceof Error) {
          chunkError = error;
        }
      }
    };

    if (options.signal.aborted) {
      stop();
    } else {
      options.signal.addEventListener('abort', stop, { once: true });
    }

    proc.onData((data) => {
      stdout += data;
      if (!options.onChunk) {
        return;
      }
      chain = chain
        .then(() => options.onChunk?.(data))
        .catch((error: unknown) => {
          chunkError = error instanceof Error ? error : new Error('输出回调失败');
          stop();
        });
    });

    if (options.stdinText !== undefined) {
      try {
        proc.write(options.stdinText);
      } catch (error) {
        chunkError = error instanceof Error ? error : new Error('无法写入伪终端');
        stop();
      }
    }

    proc.onExit(({ exitCode, signal }) => {
      stop();
      void chain.then(
        () => {
          const aborted = options.signal.aborted;
          const signalError =
            !aborted && signal !== undefined && signal !== 0
              ? new Error(`命令被信号 ${signal} 终止`)
              : undefined;
          finish({
            stdout,
            stderr: '',
            exitCode,
            error: chunkError ?? signalError,
            errorCode: readErrorCode(chunkError),
            abort: aborted,
          });
        },
        () => {
          finish({
            stdout,
            stderr: '',
            exitCode,
            error: chunkError,
            abort: options.signal.aborted,
          });
        },
      );
    });
  });
}

async function resolvePty(
  runtime: AdapterRuntime,
): Promise<{ ok: true; spawn: PtySpawn } | { ok: false; reason: string }> {
  if (runtime.ptySpawn) {
    return { ok: true, spawn: runtime.ptySpawn };
  }
  try {
    const loader = runtime.loadPty ?? loadNodePty;
    const spawnPty = await loader();
    if (!spawnPty) {
      return { ok: false, reason: 'node-pty 未能加载' };
    }
    return { ok: true, spawn: spawnPty };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'node-pty 未能加载';
    return { ok: false, reason: message };
  }
}

export function loadNodePty(): Promise<PtySpawn | undefined> {
  if (cachedPty === undefined) {
    cachedPty = importNodePty();
  }
  return cachedPty;
}

async function importNodePty(): Promise<PtySpawn | undefined> {
  try {
    const importer = new Function('specifier', 'return import(specifier)') as (
      specifier: string,
    ) => Promise<NodePtyModule>;
    const loaded = await importer('node-pty');
    if (typeof loaded.spawn !== 'function') {
      return undefined;
    }
    return loaded.spawn.bind(loaded);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'node-pty 未能加载';
    throw new Error(message, { cause: error });
  }
}

function logFallback(
  providerName: string,
  reason: string,
  log: ((message: string) => void) | undefined,
): void {
  if (loggedFallbacks.has(providerName)) {
    return;
  }
  loggedFallbacks.add(providerName);
  const message = `PTY 不可用，提供者 ${providerName} 已回退到管道模式：${reason}`;
  if (log) {
    log(message);
    return;
  }
  console.error(message);
}

function envRecord(env: NodeJS.ProcessEnv): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      record[key] = value;
    }
  }
  return record;
}

function readErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = error.code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function isGone(error: unknown): boolean {
  const code = readErrorCode(error);
  return code === 'ESRCH' || code === 'EPERM' || code === 'EINVAL';
}
