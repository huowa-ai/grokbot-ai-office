const APPROVAL_PATTERN =
  /waiting for (?:your )?approval|permission request|需要批准|等待批准|是否允许/i;

export function detectWaitingApproval(text: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    if (!APPROVAL_PATTERN.test(line)) {
      continue;
    }
    const clean = line.trim();
    return clean.length > 0 ? clean : '等待批准';
  }
  return undefined;
}
