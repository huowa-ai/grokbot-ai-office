import { spawn } from 'node:child_process';

import { killProcessTree } from './kill-tree.js';

export interface ChildResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: Error;
  errorCode?: string;
  abort: boolean;
}

export interface ProcessRunOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  stdinText?: string;
  onChunk?: (chunk: string) => void | Promise<void>;
  killTree?: (pid: number) => void;
}

export function runChild(
  bin: string,
  args: string[],
  options: ProcessRunOptions,
): Promise<ChildResult> {
  return new Promise((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;
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

    const stopTree = (pid: number | undefined): void => {
      if (pid === undefined) {
        return;
      }
      try {
        killTree(pid);
      } catch (error) {
        if (chunkError === undefined && error instanceof Error) {
          chunkError = error;
        }
      }
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, args, {
        cwd: options.cwd,
        env: options.env,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error('命令启动失败');
      finish({
        stdout: '',
        stderr: '',
        exitCode: null,
        error: normalized,
        errorCode: readErrorCode(error),
        abort: options.signal.aborted || isAbortError(error),
      });
      return;
    }

    const onAbort = (): void => {
      stopTree(child.pid);
    };
    if (options.signal.aborted) {
      onAbort();
    } else {
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout?.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdoutChunks.push(buffer);
      if (!options.onChunk) {
        return;
      }
      const text = buffer.toString('utf8');
      chain = chain
        .then(() => options.onChunk?.(text))
        .catch((error: unknown) => {
          chunkError = error instanceof Error ? error : new Error('输出回调失败');
          stopTree(child.pid);
        });
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stdin?.on('error', (error: Error) => {
      if (options.signal.aborted || isAbortError(error)) {
        stopTree(child.pid);
        finish(snapshot(stdoutChunks, stderrChunks, null, error, true));
        return;
      }
      if (readErrorCode(error) !== 'EPIPE') {
        stopTree(child.pid);
        finish(snapshot(stdoutChunks, stderrChunks, null, error, false));
      }
    });

    if (options.stdinText !== undefined) {
      child.stdin?.end(options.stdinText);
    } else {
      child.stdin?.end();
    }

    child.on('error', (error: Error) => {
      stopTree(child.pid);
      finish(
        snapshot(
          stdoutChunks,
          stderrChunks,
          null,
          error,
          options.signal.aborted || isAbortError(error),
        ),
      );
    });

    child.on('close', (exitCode, killSignal) => {
      stopTree(child.pid);
      void chain.then(
        () => {
          const aborted = options.signal.aborted;
          const signalError =
            !aborted && exitCode === null && killSignal
              ? new Error(`命令被信号 ${killSignal} 终止`)
              : undefined;
          const error = chunkError ?? signalError;
          finish(snapshot(stdoutChunks, stderrChunks, exitCode, error, aborted));
        },
        () => {
          finish(
            snapshot(stdoutChunks, stderrChunks, exitCode, chunkError, options.signal.aborted),
          );
        },
      );
    });
  });
}

function snapshot(
  stdoutChunks: Buffer[],
  stderrChunks: Buffer[],
  exitCode: number | null,
  error: Error | undefined,
  abort: boolean,
): ChildResult {
  return {
    stdout: Buffer.concat(stdoutChunks).toString('utf8'),
    stderr: Buffer.concat(stderrChunks).toString('utf8'),
    exitCode,
    error,
    errorCode: readErrorCode(error),
    abort,
  };
}

function readErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = error.code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === 'AbortError' || readErrorCode(error) === 'ABORT_ERR';
}
