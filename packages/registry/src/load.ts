import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import { parse } from 'yaml';
import type { ZodError } from 'zod';

import { type ProvidersFile, providersFileSchema } from './schema.js';

export interface ConfigIssue {
  path: string;
  message: string;
}

export class ProvidersConfigError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    const sanitized = issues.map((issue) => ({
      path: redact(issue.path),
      message: redact(issue.message),
    }));
    super(sanitized.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
    this.name = 'ProvidersConfigError';
    this.issues = sanitized;
  }
}

export function resolveProvidersPath(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env.RELAY_PROVIDERS_PATH?.trim();
  if (override && override.length > 0) {
    return path.resolve(cwd, override);
  }
  return path.join(cwd, 'configs', 'providers.yaml');
}

export function parseProvidersConfig(input: unknown): ProvidersFile {
  const result = providersFileSchema.safeParse(input);
  if (!result.success) {
    throw new ProvidersConfigError(toIssues(result.error));
  }
  return result.data;
}

export function loadProvidersConfig(filePath: string): ProvidersFile {
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : '无法读取文件';
    throw new ProvidersConfigError([{ path: filePath, message: redact(detail) }]);
  }

  let parsed: unknown;
  try {
    parsed = parse(text) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'YAML 无法解析';
    throw new ProvidersConfigError([{ path: filePath, message: redact(detail) }]);
  }

  return parseProvidersConfig(parsed);
}

function toIssues(error: ZodError): ConfigIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

function redact(value: string): string {
  if (/sk-/i.test(value)) {
    return '疑似密钥，已隐藏具体内容';
  }
  return value;
}
