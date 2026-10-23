// ABOUTME: Tests for sent-at.ts — the leading <message_meta sent_at="..."/> line a
// ABOUTME: subagent sees on every message it receives, and the subagent gate.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  sentAtMetaLine,
  stampSentAt,
  stampSentAtContent,
  stripSentAtMeta,
} from '@lace/agent/message-building/sent-at';
import { sessionStampsSentAt } from '@lace/agent/storage/session-store';

describe('sentAtMetaLine', () => {
  it('renders UTC ISO-8601 truncated to the second', () => {
    expect(sentAtMetaLine('2026-10-21T16:24:06.789Z')).toBe(
      '<message_meta sent_at="2026-10-21T16:24:06Z"/>'
    );
  });

  it('normalizes an offset timestamp to UTC', () => {
    expect(sentAtMetaLine('2026-10-21T09:24:06-07:00')).toBe(
      '<message_meta sent_at="2026-10-21T16:24:06Z"/>'
    );
  });

  it('returns undefined for a missing or unparseable timestamp', () => {
    expect(sentAtMetaLine(undefined)).toBeUndefined();
    expect(sentAtMetaLine('')).toBeUndefined();
    expect(sentAtMetaLine('not a date')).toBeUndefined();
  });
});

describe('stampSentAt', () => {
  it('puts the meta line on its own line before the text', () => {
    expect(stampSentAt('hello', '2026-10-21T16:24:06.000Z')).toBe(
      '<message_meta sent_at="2026-10-21T16:24:06Z"/>\nhello'
    );
  });

  it('leaves the text untouched when there is no usable timestamp', () => {
    expect(stampSentAt('hello', undefined)).toBe('hello');
  });
});

describe('stampSentAtContent', () => {
  const ts = '2026-10-21T16:24:06.000Z';
  const meta = '<message_meta sent_at="2026-10-21T16:24:06Z"/>';

  it('stamps string content', () => {
    expect(stampSentAtContent('hi', ts)).toBe(`${meta}\nhi`);
  });

  it('stamps the first block when it is text', () => {
    expect(
      stampSentAtContent(
        [
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' },
        ],
        ts
      )
    ).toEqual([
      { type: 'text', text: `${meta}\na` },
      { type: 'text', text: 'b' },
    ]);
  });

  it('adds a leading text block when the first block is not text', () => {
    const image = {
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: 'image/png', data: 'AAAA' },
    };
    expect(stampSentAtContent([image], ts)).toEqual([{ type: 'text', text: meta }, image]);
  });

  it('leaves empty content empty (nothing was said, so nothing to date)', () => {
    expect(stampSentAtContent('', ts)).toBe('');
    expect(stampSentAtContent([], ts)).toEqual([]);
  });

  it('returns content unchanged without a timestamp', () => {
    const blocks = [{ type: 'text' as const, text: 'a' }];
    expect(stampSentAtContent(blocks, undefined)).toBe(blocks);
  });
});

describe('stripSentAtMeta', () => {
  it('removes a leading meta line', () => {
    expect(stripSentAtMeta('<message_meta sent_at="2026-10-21T16:24:06Z"/>\ndelegate x')).toBe(
      'delegate x'
    );
  });

  it('leaves unstamped text alone', () => {
    expect(stripSentAtMeta('delegate x')).toBe('delegate x');
  });
});

describe('sessionStampsSentAt', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lace-sent-at-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const writeMeta = (extra: Record<string, unknown>) =>
    writeFileSync(
      join(dir, 'meta.json'),
      JSON.stringify({
        sessionId: 'sess_00000000-0000-4000-8000-00000000000a',
        workDir: '/tmp',
        created: 'x',
        ...extra,
      })
    );

  it('is true for a subagent session (meta has parent)', () => {
    writeMeta({ parent: { sessionId: 'sess_p', jobId: 'job_1' } });
    expect(sessionStampsSentAt(dir)).toBe(true);
  });

  it('is false for a root session', () => {
    writeMeta({});
    expect(sessionStampsSentAt(dir)).toBe(false);
  });

  it('is false when the session has no meta.json', () => {
    expect(sessionStampsSentAt(dir)).toBe(false);
  });
});
