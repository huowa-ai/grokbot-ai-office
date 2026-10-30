import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { type RelayEvent, createEvent } from '@grokbot-ai-office/core';
import { createJsonlEventSink, readEvents } from '@grokbot-ai-office/events';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

describe('createJsonlEventSink', () => {
  it('createJsonlEventSink 追加合法事件且并发写入仍是一行一个 JSON', async () => {
    const file = eventFile();
    const sink = createJsonlEventSink(file);
    await Promise.all(
      Array.from({ length: 40 }, (_, index) => sink.emit(chunkEvent(index + 1, `piece-${index}`))),
    );

    const raw = readFileSync(file, 'utf8');
    const lines = raw.split('\n').filter((line) => line.length > 0);
    expect(lines).toHaveLength(40);
    for (const line of lines) {
      expect(line.includes('\n')).toBe(false);
      expect(() => JSON.parse(line)).not.toThrow();
    }
    const events = await readEvents(file);
    expect(events).toHaveLength(40);
    expect(
      events
        .map((event) => (event.type === 'output_chunk' ? event.payload.seq : 0))
        .sort((left, right) => left - right),
    ).toEqual(Array.from({ length: 40 }, (_, index) => index + 1));
  });

  it('createJsonlEventSink 拒绝不合法事件且不写出半行', async () => {
    const file = eventFile();
    const sink = createJsonlEventSink(file);
    await expect(sink.emit({} as RelayEvent)).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
    await expect(readEvents(file)).resolves.toEqual([]);
  });

  it('createJsonlEventSink 把疑似密钥替换成占位符', async () => {
    const file = eventFile();
    const secret = ['sk', 'supersecretvalue'].join('-');
    const sink = createJsonlEventSink(file);
    await sink.emit(chunkEvent(1, `before ${secret} after`));

    const raw = readFileSync(file, 'utf8');
    expect(raw).not.toContain(secret);
    expect(raw).toContain('[REDACTED]');
    expect(raw).toContain('before');
    expect(raw).toContain('after');
  });
});

function eventFile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'events-jsonl-'));
  dirs.push(dir);
  return path.join(dir, 'nested', 'events.jsonl');
}

function chunkEvent(seq: number, text: string): RelayEvent {
  return createEvent({
    v: 1,
    id: `evt-${seq}`,
    ts: '2026-10-30T00:00:00.000Z',
    type: 'output_chunk',
    instance: 'codex@mac',
    provider: 'codex',
    host: 'mac',
    taskId: 'r_test',
    payload: { seq, text },
  });
}
