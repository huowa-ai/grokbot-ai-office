#!/usr/bin/env node
import path from 'node:path';

import { RelayError } from '@grokbot-ai-office/core';

import { loadDotEnv } from './dotenv.js';
import { run } from './main.js';

const env = { ...process.env };
loadDotEnv(path.join(process.cwd(), '.env'), env);

run(process.argv.slice(2), process.cwd(), env, {
  stdin: process.stdin,
  isTTY: process.stdin.isTTY === true,
}).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    if (error instanceof RelayError) {
      console.error(`${error.code} ${error.message}`);
    } else if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error('未知错误');
    }
    process.exitCode = 1;
  },
);
