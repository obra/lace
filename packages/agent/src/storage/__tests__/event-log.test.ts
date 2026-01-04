import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendDurableEvent, readDurableEvents } from '../event-log';

describe('storage/event-log', () => {
  it('appends and replays events in order', () => {
    const sessionDir = mkdtempSync(join(tmpdir(), 'lace-event-log-'));
    try {
      const startState = { nextEventSeq: 1, nextStreamSeq: 1 };

      const e1 = appendDurableEvent(sessionDir, startState, {
        type: 'turn_start',
        data: {},
      });

      const e2 = appendDurableEvent(sessionDir, e1.nextState, {
        type: 'message',
        data: { role: 'assistant' },
      });

      const read = readDurableEvents(sessionDir, { afterEventSeq: 0, limit: 100 });
      expect(read.hasMore).toBe(false);
      expect(read.events.map((e) => e.eventSeq)).toEqual([1, 2]);
      expect(read.events.map((e) => e.type)).toEqual(['turn_start', 'message']);
      expect(read.events[0]?.timestamp).toEqual(expect.any(String));
      expect(read.events[1]?.data).toMatchObject({ role: 'assistant' });

      expect(e2.nextState.nextEventSeq).toBe(3);
    } finally {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it('supports pagination and hasMore semantics', () => {
    const sessionDir = mkdtempSync(join(tmpdir(), 'lace-event-log-'));
    try {
      let state = { nextEventSeq: 1, nextStreamSeq: 1 };
      for (let i = 0; i < 3; i++) {
        const r = appendDurableEvent(sessionDir, state, { type: 'message', data: { i } });
        state = r.nextState;
      }

      const page1 = readDurableEvents(sessionDir, { afterEventSeq: 0, limit: 2 });
      expect(page1.events.map((e) => e.eventSeq)).toEqual([1, 2]);
      expect(page1.hasMore).toBe(true);

      const page2 = readDurableEvents(sessionDir, { afterEventSeq: 2, limit: 2 });
      expect(page2.events.map((e) => e.eventSeq)).toEqual([3]);
      expect(page2.hasMore).toBe(false);
    } finally {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it('supports type filtering with correct hasMore', () => {
    const sessionDir = mkdtempSync(join(tmpdir(), 'lace-event-log-'));
    try {
      let state = { nextEventSeq: 1, nextStreamSeq: 1 };
      for (const type of ['a', 'b', 'a', 'c']) {
        const r = appendDurableEvent(sessionDir, state, { type, data: {} });
        state = r.nextState;
      }

      const page = readDurableEvents(sessionDir, { afterEventSeq: 0, limit: 1, types: ['a'] });
      expect(page.events.map((e) => e.type)).toEqual(['a']);
      expect(page.events.map((e) => e.eventSeq)).toEqual([1]);
      expect(page.hasMore).toBe(true);
    } finally {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it('ignores a partial last line (crash safety)', () => {
    const sessionDir = mkdtempSync(join(tmpdir(), 'lace-event-log-'));
    try {
      const eventsPath = join(sessionDir, 'events.jsonl');
      writeFileSync(eventsPath, '', 'utf8');

      appendFileSync(
        eventsPath,
        `${JSON.stringify({
          eventSeq: 1,
          timestamp: new Date().toISOString(),
          type: 'message',
          data: {},
        })}\n`,
        'utf8'
      );

      appendFileSync(eventsPath, '{"eventSeq":2', 'utf8');

      const read = readDurableEvents(sessionDir, { afterEventSeq: 0, limit: 100 });
      expect(read.events.map((e) => e.eventSeq)).toEqual([1]);
      expect(read.hasMore).toBe(false);
    } finally {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });
});
