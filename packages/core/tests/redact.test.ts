import { describe, expect, it } from 'vitest';

import { redactSecrets } from '@grokbot-ai-office/core';

describe('redactSecrets', () => {
  it('redactSecrets 保留普通文本', () => {
    const text = '命令失败：ask 用户确认后再重试';
    expect(redactSecrets(text)).toBe(text);
  });

  it('redactSecrets 去掉 sk- 与 Bearer 形式的密钥', () => {
    const token = ['sk', 'supersecretvalue'].join('-');
    const bearer = `Bearer ${token}`;
    const text = `stderr ${token} then ${bearer} done`;
    const redacted = redactSecrets(text);

    expect(redacted).not.toContain(token);
    expect(redacted).toContain('[REDACTED]');
    expect(redacted).toContain('stderr');
    expect(redacted).toContain('done');
  });

  it('redactSecrets 去掉赋值形式的密钥且不误伤普通单词', () => {
    const text = `${'api'}_key=${'notreallysecretvalue'} ask-notasecret`;
    const redacted = redactSecrets(text);

    expect(redacted).not.toContain('notreallysecretvalue');
    expect(redacted).toContain('[REDACTED]');
    expect(redacted).toContain('ask-notasecret');
  });
});
