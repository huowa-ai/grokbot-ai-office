import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface OutboxEntry {
  folder: string;
  mtime: number;
  readme: string | null;
  files: Array<{ name: string; size: number }>;
}

const MAX_FILE_BYTES = 512 * 1024;

export function outboxRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.GROKBOT_OUTBOX?.trim();
  return override && override.length > 0
    ? override
    : path.join(env.HOME ?? os.homedir(), 'grokbot-outbox');
}

function walk(dir: string, prefix = ''): Array<{ name: string; size: number }> {
  const out: Array<{ name: string; size: number }> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) {
      continue;
    }
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...walk(path.join(dir, entry.name), rel));
    } else if (entry.isFile()) {
      out.push({ name: rel, size: statSync(path.join(dir, entry.name)).size });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** 新的在前：先按文件夹名开头的日期倒序，同一天再按修改时间倒序。 */
export function listOutbox(root: string, limit = 50): OutboxEntry[] {
  if (!existsSync(root)) {
    return [];
  }
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => {
      const dir = path.join(root, entry.name);
      const readmePath = path.join(dir, 'README.md');
      return {
        folder: entry.name,
        mtime: statSync(dir).mtimeMs,
        readme: existsSync(readmePath)
          ? readFileSync(readmePath, 'utf8').slice(0, MAX_FILE_BYTES)
          : null,
        files: walk(dir),
      };
    })
    .sort((a, b) => b.folder.slice(0, 10).localeCompare(a.folder.slice(0, 10)) || b.mtime - a.mtime)
    .slice(0, limit);
}

/** 只允许读 root/<folder>/ 下的文件，拒绝 .. 和绝对路径。 */
export function resolveOutboxFile(root: string, folder: string, file: string): string {
  const base = path.resolve(root, folder);
  const target = path.resolve(base, file);
  if (
    folder.includes('/') ||
    folder.startsWith('.') ||
    path.dirname(base) !== path.resolve(root) ||
    !target.startsWith(base + path.sep)
  ) {
    throw new Error('路径不合法');
  }
  return target;
}

export function readOutboxFile(root: string, folder: string, file: string): string {
  const target = resolveOutboxFile(root, folder, file);
  const size = statSync(target).size;
  const text = readFileSync(target).subarray(0, MAX_FILE_BYTES).toString('utf8');
  return size > MAX_FILE_BYTES ? `${text}\n…（文件过大，只显示前 512 KB）` : text;
}

/** 最新的 <日期>-<task> 目录里的 exit_code；没有或还没写完返回 null。 */
export function taskExitCode(root: string, task: string): number | null {
  if (!existsSync(root)) return null;
  const re = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${task.replace(/[^a-z0-9-]/g, '')}$`);
  const folder = readdirSync(root)
    .filter((n) => re.test(n))
    .sort()
    .at(-1);
  if (folder === undefined) return null;
  const file = path.join(root, folder, 'exit_code');
  if (!existsSync(file)) return null;
  const raw = readFileSync(file, 'utf8').trim();
  return raw === '' ? null : Number(raw);
}
