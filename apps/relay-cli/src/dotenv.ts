import { readFileSync } from 'node:fs';

const KEY_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function loadDotEnv(filePath: string, env: NodeJS.ProcessEnv): void {
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ENOENT') {
      return;
    }
    const message = error instanceof Error ? error.message : '无法读取 .env';
    throw new Error(`无法读取 .env：${message}`);
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue;
    }
    const line = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed;
    const separator = line.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    if (!KEY_NAME.test(key) || env[key] !== undefined) {
      continue;
    }
    env[key] = unquote(line.slice(separator + 1).trim());
  }
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = error.code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}
