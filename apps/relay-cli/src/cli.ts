#!/usr/bin/env node
import { RelayError } from '@grokbot-ai-office/core';

import { run } from './main.js';

run(process.argv.slice(2)).then(
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
