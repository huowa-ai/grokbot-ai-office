import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  test: {
    environment: 'node',
    include: ['packages/**/tests/**/*.test.ts', 'apps/**/tests/**/*.test.ts', 'tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@grokbot-ai-office/core': path.join(root, 'packages/core/src/index.ts'),
      '@grokbot-ai-office/registry': path.join(root, 'packages/registry/src/index.ts'),
      '@grokbot-ai-office/adapters': path.join(root, 'packages/adapters/src/index.ts'),
      '@grokbot-ai-office/events': path.join(root, 'packages/events/src/index.ts'),
      '@grokbot-ai-office/event-server': path.join(root, 'apps/event-server/src/index.ts'),
    },
  },
});
