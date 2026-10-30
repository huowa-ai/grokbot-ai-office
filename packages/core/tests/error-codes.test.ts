import { describe, expect, it } from 'vitest';

import { ERROR_CODES, RelayError } from '@grokbot-ai-office/core';

const ARCHITECTURE_CODES = [
  'PROVIDER_NOT_FOUND',
  'CONFIG_INVALID',
  'AUTH_MISSING',
  'AUTH_EXPIRED',
  'TIMEOUT',
  'CLI_NOT_INSTALLED',
  'CLI_EXIT_NONZERO',
  'HTTP_ERROR',
  'EMPTY_RESPONSE',
] as const;

describe('ERROR_CODES', () => {
  it('错误码清单与架构第 6 节的 9 个代码一致', () => {
    expect(ERROR_CODES).toHaveLength(9);
    expect([...ERROR_CODES]).toEqual([...ARCHITECTURE_CODES]);
    expect(new Set(ERROR_CODES).size).toBe(9);
  });

  it('RelayError 能携带全部 9 个错误码', () => {
    for (const code of ARCHITECTURE_CODES) {
      const error = new RelayError(code, '说明', { cause: new Error('原因') });
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('RelayError');
      expect(error.code).toBe(code);
      expect(error.isOperational).toBe(true);
      expect(error.cause).toBeInstanceOf(Error);
    }
  });
});
