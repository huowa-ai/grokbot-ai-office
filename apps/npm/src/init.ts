import { constants, accessSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { loadProvidersConfig } from '@grokbot-ai-office/registry';

/** 除注册表里的命令外，init 还会顺带检查这些常见 AI 命令行。 */
export const EXTRA_CLIS = ['grok', 'claude', 'gemini', 'kimi', 'qwen', 'ollama'] as const;

export const ENV_EXAMPLE = [
  '# grokbot-ai-office 环境变量。只填你要用的那几项，不要提交到 git。',
  'DEEPSEEK_API_KEY=',
  'ANTHROPIC_API_KEY=',
  'GEMINI_API_KEY=',
  'OPENROUTER_API_KEY=',
  '# 这台机器的名字，例如 mac 或 cloud',
  'RELAY_HOST=',
  'RELAY_EVENTS_PATH=',
  'RELAY_WORKSPACE=',
  'RELAY_OFFICE_PORT=',
  'RELAY_MCP_PORT=',
  '',
].join('\n');

export interface InitOptions {
  homeDir: string;
  defaultProviders: string;
  pathEnv: string | undefined;
  force?: boolean;
  stdout: (text: string) => void;
}

export function configDir(homeDir: string): string {
  return path.join(homeDir, '.grokbot-ai-office');
}

export function findOnPath(command: string, pathEnv: string | undefined): string | undefined {
  if (!pathEnv) {
    return undefined;
  }
  const exts =
    process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) {
      continue;
    }
    for (const ext of exts) {
      const candidate = path.join(dir, command + ext);
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // 不在这个目录
      }
    }
  }
  return undefined;
}

export function runInit(options: InitOptions): number {
  const { stdout } = options;
  const dir = configDir(options.homeDir);
  mkdirSync(dir, { recursive: true });

  const providersPath = path.join(dir, 'providers.yaml');
  if (existsSync(providersPath) && !options.force) {
    stdout(`已存在，未覆盖：${providersPath}（加 --force 覆盖）`);
  } else {
    copyFileSync(options.defaultProviders, providersPath);
    stdout(`已写入：${providersPath}`);
  }

  const envPath = path.join(dir, '.env');
  const envExamplePath = path.join(dir, '.env.example');
  writeFileSync(envExamplePath, ENV_EXAMPLE);
  stdout(`已写入：${envExamplePath}`);
  if (!existsSync(envPath)) {
    writeFileSync(envPath, ENV_EXAMPLE, { mode: 0o600 });
    stdout(`已写入：${envPath}（在这里填 key）`);
  }

  let config: ReturnType<typeof loadProvidersConfig>;
  try {
    config = loadProvidersConfig(providersPath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : '无法读取';
    stdout(`CONFIG_INVALID ${providersPath}：${detail}`);
    return 1;
  }
  const commands = new Map<string, string[]>();
  for (const [name, provider] of Object.entries(config.providers)) {
    const command = 'command' in provider ? provider.command : undefined;
    const bin = Array.isArray(command) ? command[0] : undefined;
    if (typeof bin === 'string') {
      commands.set(bin, [...(commands.get(bin) ?? []), name]);
    }
  }
  for (const bin of EXTRA_CLIS) {
    if (!commands.has(bin)) {
      commands.set(bin, []);
    }
  }

  stdout('');
  stdout('本机 AI 命令行检测：');
  for (const [bin, names] of commands) {
    const found = findOnPath(bin, options.pathEnv);
    const label = names.length > 0 ? `注册为 ${names.join(', ')}` : '未在 providers.yaml 注册';
    stdout(`  ${found ? '✓' : '✗'} ${bin.padEnd(12)} ${found ?? '未找到'}  (${label})`);
  }
  stdout('');
  stdout('下一步：');
  stdout(`  1. 按需编辑 ${providersPath} 和 ${envPath}`);
  stdout('  2. npx grokbot-ai-office ask <名字> "你好"');
  stdout('  3. npx grokbot-ai-office office   # 打开 3D 办公室');
  return 0;
}
