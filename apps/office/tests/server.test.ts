import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { startOfficeServer } from '../src/server/static-server.js';

const dirs: string[] = [];
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of closers) {
    await close();
  }
  closers.length = 0;
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

describe('office server', () => {
  it('提供页面，并把注册表样式盖在 JSON 上', async () => {
    const root = tempDir();
    writeFileSync(path.join(root, 'index.html'), '<p>办公室</p>');
    writeFileSync(
      path.join(root, 'office-styles.json'),
      JSON.stringify({ providers: { codex: { bezel: '#112233', body: 'robot' } }, instances: {} }),
    );
    const server = await startOfficeServer({
      root,
      port: 0,
      providerStyles: {
        providers: { codex: { body: 'whale', desk_prop: 'wave' } },
        instances: {},
      },
    });
    closers.push(() => server.close());

    const page = await fetch(`${server.url}/`);
    expect(await page.text()).toContain('办公室');
    const styles = (await (await fetch(`${server.url}/office-styles.json`)).json()) as {
      providers: { codex: { body?: string; bezel?: string; deskProp?: string } };
    };
    expect(styles.providers.codex).toEqual({
      body: 'whale',
      bezel: '#112233',
      deskProp: 'wave',
    });

    const escaped = await fetch(`${server.url}/%2e%2e%2f%2e%2e%2fpackage.json`);
    expect(escaped.status).not.toBe(200);
  });

  it('拒绝监听非本机地址', async () => {
    await expect(startOfficeServer({ root: tempDir(), host: '0.0.0.0', port: 0 })).rejects.toThrow(
      '本机',
    );
  });
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-server-'));
  dirs.push(dir);
  return dir;
}
