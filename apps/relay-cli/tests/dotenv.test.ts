import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadDotEnv } from '../src/dotenv.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

describe('loadDotEnv', () => {
  it('loadDotEnv 读取变量名且不覆盖已有环境变量', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'relay-dotenv-'));
    dirs.push(dir);
    const file = path.join(dir, '.env');
    writeFileSync(
      file,
      [
        '# comment',
        'export DEEPSEEK_API_KEY="from-file"',
        'RELAY_HOST=mac',
        'ALREADY=from-file',
      ].join('\n'),
    );
    const env: NodeJS.ProcessEnv = { ALREADY: 'from-env' };
    loadDotEnv(file, env);

    expect(env.DEEPSEEK_API_KEY).toBe('from-file');
    expect(env.RELAY_HOST).toBe('mac');
    expect(env.ALREADY).toBe('from-env');
  });

  it('loadDotEnv 在文件不存在时保持环境不变', () => {
    const env: NodeJS.ProcessEnv = {};
    loadDotEnv(path.join(tmpdir(), 'missing-relay-env'), env);
    expect(env).toEqual({});
  });
});
