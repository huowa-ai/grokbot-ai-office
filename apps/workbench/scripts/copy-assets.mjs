// 构建后把 public/ 和 xterm 资源复制到 dist/public。
import { cpSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const out = path.resolve('dist/public');
cpSync('public', out, { recursive: true });
mkdirSync(path.join(out, 'vendor'), { recursive: true });
const xterm = path.dirname(require.resolve('@xterm/xterm/package.json'));
const fit = path.dirname(require.resolve('@xterm/addon-fit/package.json'));
cpSync(path.join(xterm, 'lib/xterm.js'), path.join(out, 'vendor/xterm.js'));
cpSync(path.join(xterm, 'css/xterm.css'), path.join(out, 'vendor/xterm.css'));
cpSync(path.join(fit, 'lib/addon-fit.js'), path.join(out, 'vendor/addon-fit.js'));
