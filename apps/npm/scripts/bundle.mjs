// 把 relay-cli 和所有 workspace 包打成一个 dist/cli.js，并带上办公室页面和默认注册表。
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(root, '../..');
const dist = path.join(root, 'dist');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await build({
  entryPoints: [path.join(root, 'src/cli.ts')],
  outfile: path.join(dist, 'cli.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: ['node-pty'],
  define: { __PKG_VERSION__: JSON.stringify(pkg.version) },
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  legalComments: 'none',
  logLevel: 'warning',
});
chmodSync(path.join(dist, 'cli.js'), 0o755);

const officeDist = path.join(repo, 'apps/office/dist');
if (!existsSync(path.join(officeDist, 'index.html'))) {
  throw new Error('apps/office/dist 不存在，请先构建 @grokbot-ai-office/office');
}
cpSync(officeDist, path.join(dist, 'office'), { recursive: true });
const workbenchDist = path.join(repo, 'apps/workbench/dist/public');
if (!existsSync(path.join(workbenchDist, 'index.html'))) {
  throw new Error('apps/workbench/dist/public 不存在，请先构建 @grokbot-ai-office/workbench');
}
cpSync(workbenchDist, path.join(dist, 'workbench'), { recursive: true });
mkdirSync(path.join(dist, 'configs'), { recursive: true });
cpSync(path.join(repo, 'configs/providers.yaml'), path.join(dist, 'configs/providers.yaml'));
cpSync(path.join(repo, 'README.md'), path.join(root, 'README.md'));
cpSync(path.join(repo, 'LICENSE'), path.join(root, 'LICENSE'));
