export const ERROR_CODES = [
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

export type RelayErrorCode = (typeof ERROR_CODES)[number];

const ERROR_CODE_SET: ReadonlySet<string> = new Set(ERROR_CODES);

export function isRelayErrorCode(value: string): value is RelayErrorCode {
  return ERROR_CODE_SET.has(value);
}

export interface RelayErrorOptions {
  cause?: unknown;
  isOperational?: boolean;
}

export class RelayError extends Error {
  readonly code: RelayErrorCode;
  readonly isOperational: boolean;

  constructor(code: RelayErrorCode, message: string, options?: RelayErrorOptions) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'RelayError';
    this.code = code;
    this.isOperational = options?.isOperational ?? true;
  }
}
