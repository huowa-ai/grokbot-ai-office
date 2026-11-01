import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { run } from '../src/main.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

describe('run', () => {
  it('run 在参数不足时返回非零码', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(run([], repoRoot, {})).resolves.toBe(1);
    expect(error).toHaveBeenCalled();
  });

  it('run 在提供者不存在时打印 PROVIDER_NOT_FOUND', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await run(['missing-bot', '你好'], repoRoot, testEnv());
    expect(code).toBe(1);
    expect(error.mock.calls.some((args) => String(args[0]).includes('PROVIDER_NOT_FOUND'))).toBe(
      true,
    );
  });

  it('run 在命令不存在时打印 CLI_NOT_INSTALLED 且不编造回答', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stdout: string[] = [];
    const code = await run(['codex', '你好'], repoRoot, testEnv({ RELAY_HOST: 'mac' }), {
      stdout: (text) => {
        stdout.push(text);
      },
    });
    expect(code).toBe(1);
    expect(stdout).toEqual([]);
    expect(error.mock.calls.some((args) => String(args[0]).includes('CLI_NOT_INSTALLED'))).toBe(
      true,
    );
  });

  it('run 在 RELAY_HOST 不合法时返回 CONFIG_INVALID', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await run(['codex', '你好'], repoRoot, { RELAY_HOST: 'Mac' });
    expect(code).toBe(1);
    expect(error.mock.calls.some((args) => String(args[0]).includes('CONFIG_INVALID'))).toBe(true);
    expect(error.mock.calls.some((args) => String(args[0]).includes('Mac'))).toBe(false);
  });

  it('run 在当前主机不在 hosts 中时拒绝调用', async () => {
    const dir = writeConfig(`
version: 1
defaults:
  timeout_ms: 1000
providers:
  codex:
    auth: subscription
    command: ["node", "-e", "process.stdout.write('should-not-run')"]
    safe_mode: "-e"
    hosts: ["cloud"]
`);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await run(['codex', '你好'], dir, testEnv({ RELAY_HOST: 'mac' }));
    expect(code).toBe(1);
    expect(error.mock.calls.some((args) => String(args[0]).includes('CONFIG_INVALID'))).toBe(true);
    expect(error.mock.calls.some((args) => String(args[0]).includes('主机 mac'))).toBe(true);
    expect(error.mock.calls.some((args) => String(args[0]).includes('should-not-run'))).toBe(false);
  });

  it('run 在 provider@host 与当前主机不一致时拒绝调用', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await run(['codex@cloud', '你好'], repoRoot, testEnv({ RELAY_HOST: 'mac' }));
    expect(code).toBe(1);
    expect(error.mock.calls.some((args) => String(args[0]).includes('CONFIG_INVALID'))).toBe(true);
    expect(error.mock.calls.some((args) => String(args[0]).includes('cloud'))).toBe(true);
  });

  it('run 把适配器回答原样写到 stdout', async () => {
    const dir = writeConfig(`
version: 1
defaults:
  timeout_ms: 5000
providers:
  echo-bot:
    auth: subscription
    command: ["node", "-e", "process.stdout.write(process.argv.at(-1) ?? '')"]
    input: arg
    safe_mode: "-e"
`);
    const stdout: string[] = [];
    const code = await run(['echo-bot@mac', '你好'], dir, testEnv({ RELAY_HOST: 'mac' }), {
      stdout: (text) => {
        stdout.push(text);
      },
    });
    expect(code).toBe(0);
    expect(stdout).toEqual(['你好']);
  });

  it('run 在省略提示时从标准输入读取', async () => {
    const dir = writeConfig(`
version: 1
defaults:
  timeout_ms: 5000
providers:
  echo-bot:
    auth: subscription
    command: ["node", "-e", "let data=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (chunk) => { data += chunk; }); process.stdin.on('end', () => process.stdout.write(data));"]
    input: stdin
    safe_mode: "-e"
`);
    const stdout: string[] = [];
    const code = await run(['echo-bot'], dir, testEnv({ RELAY_HOST: 'mac' }), {
      stdin: Readable.from(['来自标准输入\n']),
      isTTY: false,
      stdout: (text) => {
        stdout.push(text);
      },
    });
    expect(code).toBe(0);
    expect(stdout).toEqual(['来自标准输入']);
  });

  it('run 支持 --stdin 和 --file，提示不经过 shell', async () => {
    const dir = writeConfig(`
version: 1
defaults:
  timeout_ms: 5000
providers:
  echo-bot:
    auth: subscription
    command: ["node", "-e", "let d=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (c) => { d += c; }); process.stdin.on('end', () => process.stdout.write(d));"]
    input: stdin
    safe_mode: "-e"
`);
    const out: string[] = [];
    const io = {
      stdout: (t: string) => {
        out.push(t);
      },
    };
    const tricky = `引号 "a" 'b' $(rm -rf /) \`x\``;
    expect(
      await run(['echo-bot', '--stdin'], dir, testEnv(), {
        ...io,
        stdin: Readable.from([tricky]),
        isTTY: true,
      }),
    ).toBe(0);
    const file = path.join(dir, 'p.txt');
    writeFileSync(file, `${tricky}\n`);
    expect(await run(['echo-bot', '--file', file], dir, testEnv(), io)).toBe(0);
    expect(out).toEqual([tricky, tricky]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await run(['echo-bot', '--file', path.join(dir, 'nope')], dir, testEnv(), io)).toBe(1);
  });
});

function writeConfig(yaml: string): string {
  const dir = tempDir();
  mkdirSync(path.join(dir, 'configs'));
  writeFileSync(path.join(dir, 'configs', 'providers.yaml'), yaml.trimStart());
  return dir;
}

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'relay-cli-'));
  dirs.push(dir);
  return dir;
}

function testEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR']) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return {
    ...env,
    RELAY_WORKSPACE: tempDir(),
    RELAY_EVENTS_PATH: path.join(tempDir(), 'events.jsonl'),
    ...extra,
  };
}
