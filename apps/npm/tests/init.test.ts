import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findOnPath, runInit } from '../src/init.js';

const repoProviders = path.resolve(__dirname, '../../../configs/providers.yaml');

describe('init', () => {
  it('创建配置目录并检测 PATH 上的命令行', () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'gao-home-'));
    const bin = mkdtempSync(path.join(os.tmpdir(), 'gao-bin-'));
    const fake = path.join(bin, 'codex');
    writeFileSync(fake, '#!/bin/sh\n');
    chmodSync(fake, 0o755);
    const lines: string[] = [];
    expect(
      runInit({
        homeDir: home,
        defaultProviders: repoProviders,
        pathEnv: bin,
        stdout: (t) => lines.push(t),
      }),
    ).toBe(0);
    const dir = path.join(home, '.grokbot-ai-office');
    expect(readFileSync(path.join(dir, 'providers.yaml'), 'utf8')).toBe(
      readFileSync(repoProviders, 'utf8'),
    );
    expect(readFileSync(path.join(dir, '.env.example'), 'utf8')).toContain('RELAY_HOST=');
    expect(lines.some((l) => l.includes('✓ codex'))).toBe(true);
    expect(lines.some((l) => l.includes('✗ grok'))).toBe(true);
  });

  it('不覆盖已有 providers.yaml，除非 --force', () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'gao-home-'));
    const opts = { homeDir: home, defaultProviders: repoProviders, pathEnv: '', stdout: () => {} };
    runInit(opts);
    const file = path.join(home, '.grokbot-ai-office', 'providers.yaml');
    writeFileSync(file, '# mine\n');
    expect(runInit(opts)).toBe(1);
    expect(readFileSync(file, 'utf8')).toBe('# mine\n');
    runInit({ ...opts, force: true });
    expect(readFileSync(file, 'utf8')).not.toBe('# mine\n');
  });

  it('PATH 为空时找不到命令', () => {
    expect(findOnPath('codex', undefined)).toBeUndefined();
  });
});
