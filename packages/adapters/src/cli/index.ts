import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import { type AdapterPort, RelayError, redactSecrets } from '@grokbot-ai-office/core';

import type { AdapterRuntime, CliInput, SubscriptionConfig } from '../types.js';
import { ensureWorkspace, resolveWorkspace } from '../workspace.js';
import { runSubscriptionProcess } from './pty.js';

const STDERR_LIMIT = 2_000;

export function createCliAdapter(
  config: SubscriptionConfig,
  providerName: string,
  runtime: AdapterRuntime = {},
): AdapterPort {
  const env = runtime.env ?? process.env;

  return {
    kind: 'cli',
    async call(request, signal) {
      const problem = safeModeProblem(config.command, config.safe_mode);
      if (problem) {
        throw new RelayError('CONFIG_INVALID', problem);
      }
      const bin = config.command[0];
      if (bin === undefined || bin.length === 0) {
        throw new RelayError('CONFIG_INVALID', '命令为空');
      }

      const workspace = workspaceRoot(runtime, env);
      try {
        await ensureWorkspace(workspace, providerName);
      } catch (error) {
        if (error instanceof RelayError) {
          throw error;
        }
        const message = error instanceof Error ? error.message : '无法创建工作目录';
        throw new RelayError('CONFIG_INVALID', `无法创建工作目录：${redactSecrets(message)}`, {
          cause: error,
        });
      }

      const input = config.input ?? 'stdin';
      const { args, promptFile } = await prepareCommand(
        config.command,
        input,
        request.prompt,
        workspace,
        providerName,
      );

      try {
        if (signal.aborted) {
          throw new RelayError('TIMEOUT', '命令已中止');
        }
        const result = await runSubscriptionProcess(
          bin,
          args,
          {
            cwd: workspace,
            env,
            signal,
            stdinText: input === 'stdin' ? request.prompt : undefined,
            onChunk: request.onOutputChunk,
            killTree: runtime.killTree,
          },
          runtime,
          providerName,
          config.pty === true,
        );
        if (signal.aborted || result.abort) {
          throw new RelayError('TIMEOUT', '命令已中止', { cause: result.error });
        }
        if (result.error instanceof RelayError) {
          throw result.error;
        }
        if (result.errorCode === 'ENOENT') {
          throw new RelayError('CLI_NOT_INSTALLED', `未找到命令 ${bin}`, { cause: result.error });
        }
        if (result.errorCode === 'EACCES') {
          throw new RelayError('CLI_NOT_INSTALLED', `无法执行命令 ${bin}`, { cause: result.error });
        }
        if (result.error) {
          const message = redactSecrets(result.error.message).slice(0, STDERR_LIMIT);
          throw new RelayError('CLI_EXIT_NONZERO', message.length > 0 ? message : '命令启动失败', {
            cause: result.error,
          });
        }
        if (result.exitCode !== 0) {
          const detail = redactSecrets(result.stderr).slice(0, STDERR_LIMIT).trim();
          const message =
            detail.length > 0
              ? `命令退出码 ${result.exitCode ?? 1}：${detail}`
              : `命令退出码 ${result.exitCode ?? 1}`;
          throw new RelayError('CLI_EXIT_NONZERO', message, { cause: detail });
        }

        const text = applyOutputFilter(result.stdout, config.output_filter);
        if (text.trim().length === 0) {
          throw new RelayError('EMPTY_RESPONSE', '命令没有输出');
        }
        return text;
      } finally {
        if (promptFile !== undefined) {
          await rm(promptFile, { force: true });
        }
      }
    },
    async selfcheck() {
      const problem = safeModeProblem(config.command, config.safe_mode);
      if (problem) {
        return { ok: false, detail: problem };
      }
      const bin = config.command[0];
      if (bin === undefined || bin.length === 0) {
        return { ok: false, detail: '命令为空' };
      }
      const found = await commandExists(bin, env);
      if (!found) {
        return { ok: false, detail: `未找到命令 ${bin}` };
      }
      return { ok: true, detail: `已找到命令 ${bin}` };
    },
  };
}

export function safeModeProblem(
  command: readonly string[],
  safeMode: string | undefined,
): string | undefined {
  if (typeof safeMode !== 'string' || safeMode.trim().length === 0) {
    return 'subscription 提供者缺少 safe_mode';
  }
  const missing = safeMode
    .trim()
    .split(/\s+/)
    .filter((token) => !command.includes(token));
  if (missing.length > 0) {
    return `命令未包含 safe_mode 要求的参数：${missing.join(' ')}`;
  }
  return undefined;
}

async function prepareCommand(
  command: readonly string[],
  input: CliInput,
  prompt: string,
  workspace: string,
  providerName: string,
): Promise<{ args: string[]; promptFile?: string }> {
  const [, ...rest] = command;
  if (input === 'arg') {
    return { args: [...rest, prompt] };
  }
  if (input === 'file') {
    if (!rest.some((arg) => arg.includes('{file}'))) {
      throw new RelayError('CONFIG_INVALID', 'input 为 file 时，命令里需要 {file} 占位符');
    }
    const promptFile = path.join(workspace, 'agents', providerName, `prompt-${randomUUID()}.txt`);
    await writeFile(promptFile, prompt, 'utf8');
    return {
      args: rest.map((arg) => arg.replaceAll('{file}', promptFile)),
      promptFile,
    };
  }
  return { args: [...rest] };
}

async function commandExists(bin: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  if (bin.includes('/') || bin.includes('\\')) {
    return canExecute(bin);
  }
  const pathValue = env.PATH ?? '';
  for (const dir of pathValue.split(path.delimiter)) {
    if (dir.length === 0) {
      continue;
    }
    if (await canExecute(path.join(dir, bin))) {
      return true;
    }
  }
  return false;
}

async function canExecute(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.X_OK);
    return true;
  } catch (error) {
    if (!(error instanceof Error)) {
      throw new RelayError('CONFIG_INVALID', '无法检查命令是否存在', { cause: error });
    }
    return false;
  }
}

function applyOutputFilter(output: string, pattern: string | undefined): string {
  if (pattern === undefined || pattern.length === 0) {
    return output;
  }
  let expression: RegExp;
  try {
    expression = new RegExp(pattern);
  } catch (error) {
    const detail = error instanceof Error ? error.message : '正则无效';
    throw new RelayError('CONFIG_INVALID', `output_filter 不是合法的正则：${detail}`, {
      cause: error,
    });
  }
  const kept = output.split(/\r?\n/).filter((line) => {
    expression.lastIndex = 0;
    return !expression.test(line);
  });
  return kept.join('\n');
}

function workspaceRoot(runtime: AdapterRuntime, env: NodeJS.ProcessEnv): string {
  if (typeof runtime.workspace === 'string' && runtime.workspace.trim().length > 0) {
    return runtime.workspace;
  }
  return resolveWorkspace(env, runtime.homeDirectory);
}
