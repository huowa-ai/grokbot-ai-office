import { mkdir } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { RelayError } from '@grokbot-ai-office/core';

const PROVIDER_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function resolveWorkspace(
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory = os.homedir(),
): string {
  const override = env.RELAY_WORKSPACE;
  if (typeof override === 'string' && override.trim().length > 0) {
    return override;
  }
  return path.join(homeDirectory, '.grokbot-ai-office', 'workspace');
}

export async function ensureWorkspace(root: string, provider: string): Promise<void> {
  if (!PROVIDER_NAME.test(provider)) {
    throw new RelayError('CONFIG_INVALID', '提供者名字不合法');
  }
  await mkdir(path.join(root, 'shared'), { recursive: true });
  await mkdir(path.join(root, 'agents', provider), { recursive: true });
  await mkdir(path.join(root, 'outbox'), { recursive: true });
}
