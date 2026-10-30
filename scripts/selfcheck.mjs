import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(root, 'apps', 'relay-cli', 'dist', 'selfcheck.js');

if (!existsSync(entry)) {
  console.error('请先执行 pnpm build，再运行 pnpm selfcheck。');
  process.exit(1);
}

const loaded = await import(pathToFileURL(entry).href);
if (typeof loaded.main !== 'function') {
  console.error('selfcheck 入口无效');
  process.exit(1);
}

const code = await loaded.main(process.argv.slice(2));
process.exitCode = typeof code === 'number' ? code : 1;
