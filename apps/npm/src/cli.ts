#!/usr/bin/env node
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RelayError } from '@grokbot-ai-office/core';
import { run } from '@grokbot-ai-office/relay-cli';
import { loadDotEnv } from '@grokbot-ai-office/relay-cli/dotenv';

import { configDir, runInit } from './init.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const bundledProviders = path.join(here, 'configs', 'providers.yaml');
const bundledOffice = path.join(here, 'office');

export function usage(): string {
  return [
    '用法：grokbot-ai-office <命令>',
    '',
    '  init [--force]               创建 ~/.grokbot-ai-office/，复制 providers.yaml 和 .env，检测本机 AI 命令行',
    '  ask <名字> [提示|--stdin|--file 路径]  向一个 AI 提问，只把回答打印到标准输出；失败时非零退出',
    '  mcp [--http] [--port 8788]   启动 MCP 服务',
    '  office [--port 8789] [--demo] 打开 3D 办公室',
    '  serve | handoff | approval | hook  与 ai-relay 相同',
    '',
    '配置查找顺序：RELAY_PROVIDERS_PATH → ./configs/providers.yaml → ~/.grokbot-ai-office/providers.yaml → 内置默认',
  ].join('\n');
}

async function main(argv: string[]): Promise<number> {
  const cwd = process.cwd();
  const env = { ...process.env };
  const home = env.HOME ?? os.homedir();
  const userDir = configDir(home);
  loadDotEnv(path.join(cwd, '.env'), env);
  loadDotEnv(path.join(userDir, '.env'), env);

  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    console.log(usage());
    return command ? 0 : 1;
  }
  if (command === '--version' || command === '-v') {
    console.log(__PKG_VERSION__);
    return 0;
  }
  if (command === 'init') {
    return runInit({
      homeDir: home,
      defaultProviders: bundledProviders,
      pathEnv: env.PATH,
      force: rest.includes('--force'),
      stdout: (text) => console.log(text),
    });
  }

  if (!env.RELAY_PROVIDERS_PATH && !existsSync(path.join(cwd, 'configs', 'providers.yaml'))) {
    const userProviders = path.join(userDir, 'providers.yaml');
    env.RELAY_PROVIDERS_PATH = existsSync(userProviders) ? userProviders : bundledProviders;
  }
  if (!env.RELAY_OFFICE_DIST && existsSync(path.join(bundledOffice, 'index.html'))) {
    env.RELAY_OFFICE_DIST = bundledOffice;
  }
  // registry 读 process.env；把解析好的路径同步回去。
  if (env.RELAY_PROVIDERS_PATH !== undefined) {
    process.env.RELAY_PROVIDERS_PATH = env.RELAY_PROVIDERS_PATH;
  }

  const relayArgv = command === 'ask' ? rest : argv;
  return run(relayArgv, cwd, env, {
    stdin: process.stdin,
    isTTY: process.stdin.isTTY === true,
  });
}

declare const __PKG_VERSION__: string;

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    if (error instanceof RelayError) {
      console.error(`${error.code} ${error.message}`);
    } else if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error('未知错误');
    }
    process.exitCode = 1;
  },
);
