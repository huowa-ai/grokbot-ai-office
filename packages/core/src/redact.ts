const SECRET_PATTERNS: readonly { source: string; flags: string }[] = [
  { source: '(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{8,}', flags: 'g' },
  { source: '(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9_]{8,}', flags: 'g' },
  { source: '(?<![A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]{8,}', flags: 'g' },
  { source: '(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}\\b', flags: 'g' },
  { source: '(?<![A-Za-z0-9])Bearer\\s+[A-Za-z0-9._~+/=-]{8,}', flags: 'gi' },
  { source: '(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{4,}', flags: 'gi' },
  {
    source:
      '(?<![A-Za-z0-9])(?:api[_-]?key|access[_-]?token|token|secret|password|authorization)\\s*[:=]\\s*["\']?[^\\s"\',]{6,}',
    flags: 'gi',
  },
];

export function redactSecrets(value: string): string {
  let redacted = value;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(new RegExp(pattern.source, pattern.flags), '[REDACTED]');
  }
  return redacted;
}
