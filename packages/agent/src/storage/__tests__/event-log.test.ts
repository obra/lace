import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  appendFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  appendDurableEvent,
  deriveNextEventSeqAcrossSessionFiles,
  findLastTurnEndEventSeq,
  hasPendingImmediateInjects,
  invalidatePersonaCache,
  legacyEventLogPath,
  readAllSessionEventLines,
  readDurableEvents,
  summarizeDurableEvents,
} from '../event-log';
import { closeRecallIndex, getRecallIndex } from '../recall/index-db';
import { writeSessionMeta } from '../session-store';

/**
 * Helper: stand up a fresh laceDir + sessionDir (with persona) and set LACE_DIR.
 *
 * The new transcript layout writes events to
 * `<laceDir>/transcripts/<persona>/<date>/<sessionId>.jsonl`. Tests that
 * previously created an arbitrary sessionDir tempdir now need a laceDir
 * structure so the writer can resolve the correct file.
 */
function makeTestSessionDirs(persona: string | null = 'ada'): {
  laceDir: string;
  sessionDir: string;
  sessionId: string;
} {
  const laceDir = mkdtempSync(join(tmpdir(), 'lace-event-log-'));
  const sessionId = `sess_${randomUUID()}`;
  const sessionDir = join(laceDir, 'agent-sessions', sessionId);
  mkdirSync(sessionDir, { recursive: true });
  if (persona !== null) {
    writeFileSync(
      join(sessionDir, 'meta.json'),
      JSON.stringify({
        sessionId,
        workDir: laceDir,
        created: new Date().toISOString(),
        persona,
      })
    );
  }
  return { laceDir, sessionDir, sessionId };
}

describe('storage/event-log', () => {
  let savedLaceDir: string | undefined;

  beforeEach(() => {
    savedLaceDir = process.env.LACE_DIR;
  });

  afterEach(() => {
    // Write-through indexing opens a process-singleton FTS DB rooted at the
    // active LACE_DIR. Tests in this file repeatedly change LACE_DIR and
    // remove the underlying tempdir, so we must release the handle between
    // cases to avoid the singleton pointing at a deleted file (and to keep
    // each case's index isolated).
    closeRecallIndex();
    if (savedLaceDir === undefined) {
      delete process.env.LACE_DIR;
    } else {
      process.env.LACE_DIR = savedLaceDir;
    }
  });

  it('appends and replays events in order', () => {
    const { laceDir, sessionDir } = makeTestSessionDirs();
    process.env.LACE_DIR = laceDir;
    invalidatePersonaCache();
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
      rmSync(laceDir, { recursive: true, force: true });
    }
  });

  it('supports pagination and hasMore semantics', () => {
    const { laceDir, sessionDir } = makeTestSessionDirs();
    process.env.LACE_DIR = laceDir;
    invalidatePersonaCache();
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
      rmSync(laceDir, { recursive: true, force: true });
    }
  });

  it('supports type filtering with correct hasMore', () => {
    const { laceDir, sessionDir } = makeTestSessionDirs();
    process.env.LACE_DIR = laceDir;
    invalidatePersonaCache();
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
      rmSync(laceDir, { recursive: true, force: true });
    }
  });

  it('findLastTurnEndEventSeq returns null on empty log and the latest turn_end seq otherwise', () => {
    const { laceDir, sessionDir } = makeTestSessionDirs();
    process.env.LACE_DIR = laceDir;
    invalidatePersonaCache();
    try {
      expect(findLastTurnEndEventSeq(sessionDir)).toBeNull();

      let state = { nextEventSeq: 1, nextStreamSeq: 1 };
      ({ nextState: state } = appendDurableEvent(sessionDir, state, { type: 'prompt', data: {} }));
      ({ nextState: state } = appendDurableEvent(sessionDir, state, {
        type: 'turn_end',
        data: { stopReason: 'end_turn' },
      }));
      ({ nextState: state } = appendDurableEvent(sessionDir, state, {
        type: 'context_injected',
        data: { priority: 'immediate', content: [] },
      }));
      expect(findLastTurnEndEventSeq(sessionDir)).toBe(2);
    } finally {
      rmSync(laceDir, { recursive: true, force: true });
    }
  });

  it('reads a legacy turn_end event (no stopDetails field) back without synthesis', () => {
    // Pre-chunk-G events were written with only { stopReason, usage } — no
    // stopDetails field. Verify they deserialize cleanly: the field is absent
    // from the parsed object (i.e. undefined), and nothing in the read path
    // synthesizes a value.
    const { laceDir, sessionDir } = makeTestSessionDirs();
    process.env.LACE_DIR = laceDir;
    invalidatePersonaCache();
    try {
      let state = { nextEventSeq: 1, nextStreamSeq: 1 };
      ({ nextState: state } = appendDurableEvent(sessionDir, state, {
        type: 'turn_end',
        data: {
          stopReason: 'end_turn',
          usage: { inputTokens: 1, outputTokens: 2, costUsd: 0 },
        },
      }));

      const { events } = readDurableEvents(sessionDir, {
        afterEventSeq: 0,
        limit: 10,
      });
      expect(events).toHaveLength(1);
      const event = events[0]!;
      expect(event.type).toBe('turn_end');

      const data = event.data as {
        stopReason: string;
        stopDetails?: unknown;
      };
      expect(data.stopReason).toBe('end_turn');
      // Legacy events: field absent → undefined. Read path does not synthesize.
      expect(data.stopDetails).toBeUndefined();
      expect('stopDetails' in data).toBe(false);
    } finally {
      rmSync(laceDir, { recursive: true, force: true });
    }
  });

  describe('hasPendingImmediateInjects', () => {
    it('returns false on an empty / missing log', () => {
      const { laceDir, sessionDir } = makeTestSessionDirs();
      process.env.LACE_DIR = laceDir;
      invalidatePersonaCache();
      try {
        expect(hasPendingImmediateInjects(sessionDir, 0)).toBe(false);
      } finally {
        rmSync(laceDir, { recursive: true, force: true });
      }
    });

    it('returns true when a context_injected priority=immediate event exists past the watermark', () => {
      const { laceDir, sessionDir } = makeTestSessionDirs();
      process.env.LACE_DIR = laceDir;
      invalidatePersonaCache();
      try {
        let state = { nextEventSeq: 1, nextStreamSeq: 1 };
        ({ nextState: state } = appendDurableEvent(sessionDir, state, {
          type: 'prompt',
          data: {},
        }));
        ({ nextState: state } = appendDurableEvent(sessionDir, state, {
          type: 'turn_end',
          data: { stopReason: 'end_turn' },
        }));
        const lastTurnEnd = findLastTurnEndEventSeq(sessionDir);
        expect(lastTurnEnd).toBe(2);
        // Nothing past turn_end yet — should be false.
        expect(hasPendingImmediateInjects(sessionDir, lastTurnEnd!)).toBe(false);
        // Inject an immediate event that lands AFTER turn_end.
        ({ nextState: state } = appendDurableEvent(sessionDir, state, {
          type: 'context_injected',
          data: { priority: 'immediate', content: [{ type: 'text', text: 'late' }] },
        }));
        expect(hasPendingImmediateInjects(sessionDir, lastTurnEnd!)).toBe(true);
      } finally {
        rmSync(laceDir, { recursive: true, force: true });
      }
    });

    it('ignores context_injected events with non-immediate priority', () => {
      const { laceDir, sessionDir } = makeTestSessionDirs();
      process.env.LACE_DIR = laceDir;
      invalidatePersonaCache();
      try {
        let state = { nextEventSeq: 1, nextStreamSeq: 1 };
        ({ nextState: state } = appendDurableEvent(sessionDir, state, {
          type: 'context_injected',
          data: { priority: 'normal', content: [{ type: 'text', text: 'normal' }] },
        }));
        expect(hasPendingImmediateInjects(sessionDir, 0)).toBe(false);
      } finally {
        rmSync(laceDir, { recursive: true, force: true });
      }
    });

    it('ignores context_injected events at or before the watermark', () => {
      const { laceDir, sessionDir } = makeTestSessionDirs();
      process.env.LACE_DIR = laceDir;
      invalidatePersonaCache();
      try {
        let state = { nextEventSeq: 1, nextStreamSeq: 1 };
        ({ nextState: state } = appendDurableEvent(sessionDir, state, {
          type: 'context_injected',
          data: { priority: 'immediate', content: [{ type: 'text', text: 'old' }] },
        }));
        // eventSeq will be 1 — at-watermark should be excluded, before-watermark too.
        expect(hasPendingImmediateInjects(sessionDir, 1)).toBe(false);
        // But it IS visible if the watermark is 0.
        expect(hasPendingImmediateInjects(sessionDir, 0)).toBe(true);
      } finally {
        rmSync(laceDir, { recursive: true, force: true });
      }
    });

    it('ignores non-context_injected event types', () => {
      const { laceDir, sessionDir } = makeTestSessionDirs();
      process.env.LACE_DIR = laceDir;
      invalidatePersonaCache();
      try {
        let state = { nextEventSeq: 1, nextStreamSeq: 1 };
        ({ nextState: state } = appendDurableEvent(sessionDir, state, {
          type: 'turn_start',
          data: { priority: 'immediate' },
        }));
        expect(hasPendingImmediateInjects(sessionDir, 0)).toBe(false);
      } finally {
        rmSync(laceDir, { recursive: true, force: true });
      }
    });
  });

  it('ignores a partial last line (crash safety)', () => {
    const { laceDir, sessionDir } = makeTestSessionDirs();
    process.env.LACE_DIR = laceDir;
    invalidatePersonaCache();
    try {
      // Write directly to the legacy path; the dual-read should still pick it up.
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
      rmSync(laceDir, { recursive: true, force: true });
    }
  });

  describe('appendDurableEvent — new layout', () => {
    it('tolerates legacy meta.json with invalid persona (routes to _unknown, logs warning)', () => {
      const laceDir = mkdtempSync(join(tmpdir(), 'lace-bcmeta-'));
      process.env.LACE_DIR = laceDir;
      const sessionId = `sess_${randomUUID()}`;
      const sessionDir = join(laceDir, 'agent-sessions', sessionId);
      mkdirSync(sessionDir, { recursive: true });
      // Persona with leading dash — invalid under new rules but a legacy session
      // may have written this to meta.json before the validation tightened.
      writeFileSync(
        join(sessionDir, 'meta.json'),
        JSON.stringify({
          sessionId,
          workDir: laceDir,
          created: 'x',
          persona: '-bad',
        })
      );
      invalidatePersonaCache(sessionDir);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        expect(() =>
          appendDurableEvent(
            sessionDir,
            { nextEventSeq: 1, nextStreamSeq: 1 },
            {
              type: 'prompt',
              data: { type: 'prompt', content: [{ type: 'text', text: 'hi' }] },
            }
          )
        ).not.toThrow();

        const today = new Date().toISOString().slice(0, 10);
        const transcriptPath = join(
          laceDir,
          'transcripts',
          '_unknown',
          today,
          `${sessionId}.jsonl`
        );
        expect(existsSync(transcriptPath)).toBe(true);
        expect(warnSpy).toHaveBeenCalled();
        expect(String(warnSpy.mock.calls[0]?.[0] ?? '')).toMatch(/invalid persona/);
      } finally {
        warnSpy.mockRestore();
        rmSync(laceDir, { recursive: true, force: true });
      }
    });

    it('writes events under transcripts/<persona>/<date>/<session>.jsonl', () => {
      const { laceDir, sessionDir, sessionId } = makeTestSessionDirs('ada');
      process.env.LACE_DIR = laceDir;
      invalidatePersonaCache();
      try {
        const startState = { nextEventSeq: 1, nextStreamSeq: 1 };
        appendDurableEvent(sessionDir, startState, {
          type: 'prompt',
          data: { type: 'prompt', content: [{ type: 'text', text: 'hi' }] },
        });

        const today = new Date().toISOString().slice(0, 10);
        const transcriptPath = join(laceDir, 'transcripts', 'ada', today, `${sessionId}.jsonl`);
        expect(existsSync(transcriptPath)).toBe(true);
        const lines = readFileSync(transcriptPath, 'utf8').trim().split('\n');
        expect(lines).toHaveLength(1);
        expect(JSON.parse(lines[0])).toMatchObject({ type: 'prompt', eventSeq: 1 });

        // Legacy path should NOT be written.
        expect(existsSync(join(sessionDir, 'events.jsonl'))).toBe(false);
      } finally {
        rmSync(laceDir, { recursive: true, force: true });
      }
    });

    it('creates transcript directory with mode 0o700', () => {
      const laceDir = mkdtempSync(join(tmpdir(), 'lace-mode-dir-'));
      process.env.LACE_DIR = laceDir;
      const sessionId = `sess_${randomUUID()}`;
      const sessionDir = join(laceDir, 'agent-sessions', sessionId);
      mkdirSync(sessionDir, { recursive: true });
      writeFileSync(
        join(sessionDir, 'meta.json'),
        JSON.stringify({
          sessionId,
          workDir: laceDir,
          created: 'x',
          persona: 'ada',
        })
      );
      invalidatePersonaCache();
      try {
        appendDurableEvent(
          sessionDir,
          { nextEventSeq: 1, nextStreamSeq: 1 },
          {
            type: 'prompt',
            data: { type: 'prompt', content: [{ type: 'text', text: 'hi' }] },
          }
        );

        const today = new Date().toISOString().slice(0, 10);
        const dateDir = join(laceDir, 'transcripts', 'ada', today);
        const dirStat = statSync(dateDir);
        expect(dirStat.mode & 0o777).toBe(0o700);
      } finally {
        rmSync(laceDir, { recursive: true, force: true });
      }
    });

    it('creates transcript file with mode 0o600', () => {
      const laceDir = mkdtempSync(join(tmpdir(), 'lace-mode-file-'));
      process.env.LACE_DIR = laceDir;
      const sessionId = `sess_${randomUUID()}`;
      const sessionDir = join(laceDir, 'agent-sessions', sessionId);
      mkdirSync(sessionDir, { recursive: true });
      writeFileSync(
        join(sessionDir, 'meta.json'),
        JSON.stringify({
          sessionId,
          workDir: laceDir,
          created: 'x',
          persona: 'ada',
        })
      );
      invalidatePersonaCache();
      try {
        appendDurableEvent(
          sessionDir,
          { nextEventSeq: 1, nextStreamSeq: 1 },
          {
            type: 'prompt',
            data: { type: 'prompt', content: [{ type: 'text', text: 'hi' }] },
          }
        );

        const today = new Date().toISOString().slice(0, 10);
        const transcriptPath = join(laceDir, 'transcripts', 'ada', today, `${sessionId}.jsonl`);
        const fileStat = statSync(transcriptPath);
        expect(fileStat.mode & 0o777).toBe(0o600);
      } finally {
        rmSync(laceDir, { recursive: true, force: true });
      }
    });

    it('writes successive events on the same UTC day to the same file', () => {
      const { laceDir, sessionDir, sessionId } = makeTestSessionDirs('ada');
      process.env.LACE_DIR = laceDir;
      invalidatePersonaCache();
      try {
        let state = { nextEventSeq: 1, nextStreamSeq: 1 };
        for (let i = 0; i < 4; i++) {
          ({ nextState: state } = appendDurableEvent(sessionDir, state, {
            type: 'message',
            data: { i },
          }));
        }

        const today = new Date().toISOString().slice(0, 10);
        const transcriptPath = join(laceDir, 'transcripts', 'ada', today, `${sessionId}.jsonl`);
        const lines = readFileSync(transcriptPath, 'utf8').trim().split('\n');
        expect(lines).toHaveLength(4);
        const seqs = lines.map((l) => (JSON.parse(l) as { eventSeq: number }).eventSeq);
        expect(seqs).toEqual([1, 2, 3, 4]);
      } finally {
        rmSync(laceDir, { recursive: true, force: true });
      }
    });

    it('routes to _unknown when meta.json is missing or has no persona', () => {
      const laceDir = mkdtempSync(join(tmpdir(), 'lace-event-log-unk-'));
      const sessionId = `sess_${randomUUID()}`;
      const sessionDir = join(laceDir, 'agent-sessions', sessionId);
      mkdirSync(sessionDir, { recursive: true });
      // Intentionally no meta.json
      process.env.LACE_DIR = laceDir;
      invalidatePersonaCache();
      try {
        appendDurableEvent(
          sessionDir,
          { nextEventSeq: 1, nextStreamSeq: 1 },
          {
            type: 'prompt',
            data: {},
          }
        );

        const today = new Date().toISOString().slice(0, 10);
        const transcriptPath = join(
          laceDir,
          'transcripts',
          '_unknown',
          today,
          `${sessionId}.jsonl`
        );
        expect(existsSync(transcriptPath)).toBe(true);
      } finally {
        rmSync(laceDir, { recursive: true, force: true });
      }
    });

    it('does NOT permanently cache a null persona — recovers when meta.json appears later (C4)', () => {
      // C4: an append before meta.json is committed would cache `null` for
      // the sessionDir, splitting the session across `_unknown/` and the
      // real persona bucket forever in this process. The fix: never cache
      // `null` results, and invalidate the cache when writeSessionMeta
      // commits. The session is still split (the first append legitimately
      // had no persona) but the SECOND append must land in the canonical
      // bucket.
      const laceDir = mkdtempSync(join(tmpdir(), 'lace-event-log-c4-'));
      const sessionId = `sess_${randomUUID()}`;
      const sessionDir = join(laceDir, 'agent-sessions', sessionId);
      mkdirSync(sessionDir, { recursive: true });
      process.env.LACE_DIR = laceDir;
      invalidatePersonaCache();
      try {
        // First append BEFORE meta.json — this would poison the cache under
        // the old behavior.
        let state = { nextEventSeq: 1, nextStreamSeq: 1 };
        ({ nextState: state } = appendDurableEvent(sessionDir, state, {
          type: 'prompt',
          data: { content: [{ type: 'text', text: 'first' }] },
        }));

        // Write meta.json with the real persona. writeSessionMeta also
        // invalidates the persona cache, so the next append picks up 'ada'.
        writeSessionMeta(sessionDir, {
          sessionId: sessionId as `sess_${string}`,
          workDir: laceDir,
          created: '2026-05-23T00:00:00Z',
          persona: 'ada',
        } as Parameters<typeof writeSessionMeta>[1]);

        // Second append — must use 'ada', not stale `null` from the cache.
        ({ nextState: state } = appendDurableEvent(sessionDir, state, {
          type: 'prompt',
          data: { content: [{ type: 'text', text: 'second' }] },
        }));

        const today = new Date().toISOString().slice(0, 10);
        const adaPath = join(laceDir, 'transcripts', 'ada', today, `${sessionId}.jsonl`);
        expect(existsSync(adaPath)).toBe(true);
        const adaLines = readFileSync(adaPath, 'utf8').trim().split('\n');
        // The second append landed in 'ada' as expected.
        expect(adaLines.length).toBeGreaterThanOrEqual(1);
      } finally {
        rmSync(laceDir, { recursive: true, force: true });
      }
    });

    it('returns nextState.nextEventSeq = written.eventSeq + 1 even when input state is stale (H21)', () => {
      const laceDir = mkdtempSync(join(tmpdir(), 'lace-stale-'));
      process.env.LACE_DIR = laceDir;
      const sessionId = `sess_${randomUUID()}`;
      const sessionDir = join(laceDir, 'agent-sessions', sessionId);
      mkdirSync(sessionDir, { recursive: true });
      writeFileSync(
        join(sessionDir, 'meta.json'),
        JSON.stringify({
          sessionId,
          workDir: laceDir,
          created: 'x',
          persona: 'ada',
        })
      );
      invalidatePersonaCache(sessionDir);
      try {
        // Pre-seed disk with events 1..5 in the new layout so derive sees max=5.
        const today = new Date().toISOString().slice(0, 10);
        const transcriptDir = join(laceDir, 'transcripts', 'ada', today);
        mkdirSync(transcriptDir, { recursive: true });
        writeFileSync(
          join(transcriptDir, `${sessionId}.jsonl`),
          [1, 2, 3, 4, 5]
            .map((seq) =>
              JSON.stringify({
                eventSeq: seq,
                timestamp: 'x',
                type: 'prompt',
                data: { type: 'prompt', content: [] },
              })
            )
            .join('\n') + '\n'
        );

        // Caller has stale state: state.nextEventSeq=3 (out of date with disk).
        const { written, nextState } = appendDurableEvent(
          sessionDir,
          { nextEventSeq: 3, nextStreamSeq: 1 },
          {
            type: 'prompt',
            data: { type: 'prompt', content: [{ type: 'text', text: 'late' }] },
          }
        );

        expect(written.eventSeq).toBe(6); // disk-derived, correct
        expect(nextState.nextEventSeq).toBe(7); // must track disk, not state+1
      } finally {
        rmSync(laceDir, { recursive: true, force: true });
      }
    });

    it('persona cache avoids repeated meta.json reads for the same sessionDir', () => {
      const { laceDir, sessionDir, sessionId } = makeTestSessionDirs('ada');
      process.env.LACE_DIR = laceDir;
      invalidatePersonaCache();
      try {
        let state = { nextEventSeq: 1, nextStreamSeq: 1 };
        ({ nextState: state } = appendDurableEvent(sessionDir, state, {
          type: 'prompt',
          data: {},
        }));

        // Mutate meta.json to a different persona. The cache should keep
        // returning 'ada' so writes stay in the ada bucket.
        writeFileSync(
          join(sessionDir, 'meta.json'),
          JSON.stringify({ sessionId, workDir: laceDir, created: 'x', persona: 'bea' })
        );

        ({ nextState: state } = appendDurableEvent(sessionDir, state, {
          type: 'message',
          data: {},
        }));

        const today = new Date().toISOString().slice(0, 10);
        const adaPath = join(laceDir, 'transcripts', 'ada', today);
        // Files all under 'ada'; no 'bea' directory at all.
        const personasDir = join(laceDir, 'transcripts');
        const personas = readdirSync(personasDir);
        expect(personas).toEqual(['ada']);
        expect(existsSync(adaPath)).toBe(true);
      } finally {
        rmSync(laceDir, { recursive: true, force: true });
      }
    });
  });

  describe('legacyEventLogPath', () => {
    it('returns the path under agentSessionsDir() default location', () => {
      const laceDir = mkdtempSync(join(tmpdir(), 'lace-legacy-default-'));
      process.env.LACE_DIR = laceDir;
      delete process.env.LACE_SESSION_DIR;
      try {
        const p = legacyEventLogPath('sess_xyz');
        expect(p).toBe(join(laceDir, 'agent-sessions', 'sess_xyz', 'events.jsonl'));
      } finally {
        rmSync(laceDir, { recursive: true, force: true });
      }
    });

    it('honors LACE_SESSION_DIR override', () => {
      const sessionDir = mkdtempSync(join(tmpdir(), 'lace-sessoverride-'));
      const laceDir = mkdtempSync(join(tmpdir(), 'lace-legacy-override-'));
      process.env.LACE_DIR = laceDir;
      process.env.LACE_SESSION_DIR = sessionDir;
      try {
        const p = legacyEventLogPath('sess_xyz');
        expect(p).toBe(join(sessionDir, 'sess_xyz', 'events.jsonl'));
      } finally {
        delete process.env.LACE_SESSION_DIR;
        rmSync(sessionDir, { recursive: true, force: true });
        rmSync(laceDir, { recursive: true, force: true });
      }
    });
  });

  describe('deriveNextEventSeqAcrossSessionFiles', () => {
    it('returns 1 when no files exist', () => {
      const laceDir = mkdtempSync(join(tmpdir(), 'lace-derive-empty-'));
      try {
        expect(deriveNextEventSeqAcrossSessionFiles(laceDir, 'sess_nothing')).toBe(1);
      } finally {
        rmSync(laceDir, { recursive: true, force: true });
      }
    });

    it('reads max eventSeq from a new-layout file', () => {
      const { laceDir, sessionId } = makeTestSessionDirs('ada');
      const today = new Date().toISOString().slice(0, 10);
      const dir = join(laceDir, 'transcripts', 'ada', today);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, `${sessionId}.jsonl`),
        [1, 2, 3]
          .map((seq) =>
            JSON.stringify({ eventSeq: seq, timestamp: 'x', type: 'message', data: {} })
          )
          .join('\n') + '\n'
      );
      try {
        expect(deriveNextEventSeqAcrossSessionFiles(laceDir, sessionId)).toBe(4);
      } finally {
        rmSync(laceDir, { recursive: true, force: true });
      }
    });

    it('sees legacy events in LACE_SESSION_DIR fallback (H9)', () => {
      const laceDir = mkdtempSync(join(tmpdir(), 'lace-derive-l-'));
      const sessionDir = mkdtempSync(join(tmpdir(), 'lace-derive-s-'));
      process.env.LACE_DIR = laceDir;
      process.env.LACE_SESSION_DIR = sessionDir;
      const sessionId = `sess_${randomUUID()}`;
      invalidatePersonaCache(`${sessionDir}/${sessionId}`);
      try {
        const legacySessionDir = join(sessionDir, sessionId);
        mkdirSync(legacySessionDir, { recursive: true });
        writeFileSync(
          join(legacySessionDir, 'events.jsonl'),
          [1, 2, 3]
            .map((seq) =>
              JSON.stringify({
                eventSeq: seq,
                timestamp: 'x',
                type: 'prompt',
                data: { type: 'prompt', content: [] },
              })
            )
            .join('\n') + '\n'
        );

        const next = deriveNextEventSeqAcrossSessionFiles(laceDir, sessionId);
        expect(next).toBe(4);
      } finally {
        delete process.env.LACE_SESSION_DIR;
        rmSync(sessionDir, { recursive: true, force: true });
        rmSync(laceDir, { recursive: true, force: true });
      }
    });

    it('reads max eventSeq across legacy + new layouts', () => {
      const { laceDir, sessionDir, sessionId } = makeTestSessionDirs('ada');
      // Legacy events.jsonl with seqs 1, 2, 3.
      writeFileSync(
        join(sessionDir, 'events.jsonl'),
        [1, 2, 3]
          .map((seq) =>
            JSON.stringify({ eventSeq: seq, timestamp: 'x', type: 'message', data: {} })
          )
          .join('\n') + '\n'
      );
      // New-layout file with seqs 4, 5.
      const today = new Date().toISOString().slice(0, 10);
      const dir = join(laceDir, 'transcripts', 'ada', today);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, `${sessionId}.jsonl`),
        [4, 5]
          .map((seq) =>
            JSON.stringify({ eventSeq: seq, timestamp: 'x', type: 'message', data: {} })
          )
          .join('\n') + '\n'
      );
      try {
        expect(deriveNextEventSeqAcrossSessionFiles(laceDir, sessionId)).toBe(6);
      } finally {
        rmSync(laceDir, { recursive: true, force: true });
      }
    });
  });

  describe('readAllSessionEventLines sort order', () => {
    it('returns lines sorted by eventSeq even with mixed-layout interleaving (S6/S4)', () => {
      const laceDir = mkdtempSync(join(tmpdir(), 'lace-sort-'));
      process.env.LACE_DIR = laceDir;
      const sessionId = `sess_${randomUUID()}`;
      const sessionDir = join(laceDir, 'agent-sessions', sessionId);
      mkdirSync(sessionDir, { recursive: true });
      try {
        // Legacy file with seqs 1, 3, 5 — would be read FIRST under previous order
        writeFileSync(
          join(sessionDir, 'events.jsonl'),
          [1, 3, 5]
            .map((seq) =>
              JSON.stringify({
                eventSeq: seq,
                timestamp: 'x',
                type: 'prompt',
                data: { type: 'prompt', content: [] },
              })
            )
            .join('\n') + '\n'
        );

        // New-layout file with seqs 2, 4, 6 — would be read SECOND
        const today = new Date().toISOString().slice(0, 10);
        const transcriptDir = join(laceDir, 'transcripts', 'ada', today);
        mkdirSync(transcriptDir, { recursive: true });
        writeFileSync(
          join(transcriptDir, `${sessionId}.jsonl`),
          [2, 4, 6]
            .map((seq) =>
              JSON.stringify({
                eventSeq: seq,
                timestamp: 'x',
                type: 'prompt',
                data: { type: 'prompt', content: [] },
              })
            )
            .join('\n') + '\n'
        );

        const lines = readAllSessionEventLines(sessionDir);
        const seqs = lines.map((l) => (JSON.parse(l) as { eventSeq: number }).eventSeq);
        expect(seqs).toEqual([1, 2, 3, 4, 5, 6]);
      } finally {
        rmSync(laceDir, { recursive: true, force: true });
      }
    });
  });

  describe('turn_end dedup invariant (PRI-1818 #2)', () => {
    it('silently skips a second turn_end for the same turnId, leaving only the first', () => {
      const { laceDir, sessionDir } = makeTestSessionDirs();
      process.env.LACE_DIR = laceDir;
      invalidatePersonaCache();
      try {
        const turnId = 'turn_dedup_test';
        let state = { nextEventSeq: 1, nextStreamSeq: 1 };

        // First turn_end: stopReason from the runner (the truthful one).
        const first = appendDurableEvent(sessionDir, state, {
          type: 'turn_end',
          turnId,
          turnSeq: 0,
          data: { type: 'turn_end', stopReason: 'end_turn' },
        });
        state = first.nextState;

        // Second turn_end (the prompt.ts fallback): must be silently rejected.
        const second = appendDurableEvent(sessionDir, state, {
          type: 'turn_end',
          turnId,
          turnSeq: 1,
          data: { type: 'turn_end', stopReason: 'prompt_handler_caught' },
        });

        // State is unchanged after a deduped write.
        expect(second.nextState.nextEventSeq).toBe(state.nextEventSeq);

        // Exactly one turn_end for this turnId remains in the log, and it is
        // the FIRST one (the runner's), not the prompt.ts fallback.
        const { events } = readDurableEvents(sessionDir, { afterEventSeq: 0, limit: 100 });
        const turnEnds = events.filter(
          (e) => e.type === 'turn_end' && (e as { turnId?: string }).turnId === turnId
        );
        expect(turnEnds).toHaveLength(1);
        expect(turnEnds[0]?.data).toMatchObject({ stopReason: 'end_turn' });
      } finally {
        rmSync(laceDir, { recursive: true, force: true });
      }
    });

    it('allows turn_end for a DIFFERENT turnId after a previous turn closed', () => {
      const { laceDir, sessionDir } = makeTestSessionDirs();
      process.env.LACE_DIR = laceDir;
      invalidatePersonaCache();
      try {
        let state = { nextEventSeq: 1, nextStreamSeq: 1 };

        const r1 = appendDurableEvent(sessionDir, state, {
          type: 'turn_end',
          turnId: 'turn_one',
          turnSeq: 0,
          data: { type: 'turn_end', stopReason: 'end_turn' },
        });
        state = r1.nextState;

        const r2 = appendDurableEvent(sessionDir, state, {
          type: 'turn_end',
          turnId: 'turn_two',
          turnSeq: 0,
          data: { type: 'turn_end', stopReason: 'end_turn' },
        });
        state = r2.nextState;

        const { events } = readDurableEvents(sessionDir, { afterEventSeq: 0, limit: 100 });
        const turnIds = events
          .filter((e) => e.type === 'turn_end')
          .map((e) => (e as { turnId?: string }).turnId);
        expect(turnIds).toEqual(['turn_one', 'turn_two']);
      } finally {
        rmSync(laceDir, { recursive: true, force: true });
      }
    });

    it('does not block a turn_end when no turnId is supplied (edge case)', () => {
      // The dedup invariant is keyed on turnId; events without one (which we
      // don't expect in production turn_end writes) are not deduped.
      const { laceDir, sessionDir } = makeTestSessionDirs();
      process.env.LACE_DIR = laceDir;
      invalidatePersonaCache();
      try {
        let state = { nextEventSeq: 1, nextStreamSeq: 1 };
        const r1 = appendDurableEvent(sessionDir, state, {
          type: 'turn_end',
          data: { type: 'turn_end', stopReason: 'end_turn' },
        });
        state = r1.nextState;
        const r2 = appendDurableEvent(sessionDir, state, {
          type: 'turn_end',
          data: { type: 'turn_end', stopReason: 'end_turn' },
        });
        state = r2.nextState;

        const { events } = readDurableEvents(sessionDir, { afterEventSeq: 0, limit: 100 });
        expect(events.filter((e) => e.type === 'turn_end')).toHaveLength(2);
      } finally {
        rmSync(laceDir, { recursive: true, force: true });
      }
    });
  });

  describe('dual-read: readers see both legacy and new layouts', () => {
    it('readDurableEvents merges events from both layouts in seq order', () => {
      const { laceDir, sessionDir, sessionId } = makeTestSessionDirs('ada');
      process.env.LACE_DIR = laceDir;
      invalidatePersonaCache();
      try {
        // 3 events in legacy path
        writeFileSync(
          join(sessionDir, 'events.jsonl'),
          [1, 2, 3]
            .map((seq) =>
              JSON.stringify({ eventSeq: seq, timestamp: 'x', type: 'prompt', data: {} })
            )
            .join('\n') + '\n'
        );
        // 2 events in new layout
        const newDir = join(laceDir, 'transcripts', 'ada', '2026-05-23');
        mkdirSync(newDir, { recursive: true });
        writeFileSync(
          join(newDir, `${sessionId}.jsonl`),
          [4, 5]
            .map((seq) =>
              JSON.stringify({ eventSeq: seq, timestamp: 'x', type: 'message', data: {} })
            )
            .join('\n') + '\n'
        );

        const { events } = readDurableEvents(sessionDir, {});
        expect(events.map((e) => e.eventSeq)).toEqual([1, 2, 3, 4, 5]);
      } finally {
        rmSync(laceDir, { recursive: true, force: true });
      }
    });

    it('summarizeDurableEvents merges across layouts', () => {
      const { laceDir, sessionDir, sessionId } = makeTestSessionDirs('ada');
      process.env.LACE_DIR = laceDir;
      invalidatePersonaCache();
      try {
        writeFileSync(
          join(sessionDir, 'events.jsonl'),
          [
            { eventSeq: 1, timestamp: '2026-01-01T00:00:00Z', type: 'prompt', data: {} },
            { eventSeq: 2, timestamp: '2026-01-01T00:00:01Z', type: 'turn_start', data: {} },
          ]
            .map((e) => JSON.stringify(e))
            .join('\n') + '\n'
        );
        const newDir = join(laceDir, 'transcripts', 'ada', '2026-05-23');
        mkdirSync(newDir, { recursive: true });
        writeFileSync(
          join(newDir, `${sessionId}.jsonl`),
          JSON.stringify({
            eventSeq: 3,
            timestamp: '2026-05-23T00:00:00Z',
            type: 'message',
            data: {},
          }) + '\n'
        );

        const summary = summarizeDurableEvents(sessionDir);
        expect(summary.messageCount).toBe(2); // prompt + message
        expect(summary.turnCount).toBe(1);
        expect(summary.lastActive).toBe('2026-05-23T00:00:00Z');
      } finally {
        rmSync(laceDir, { recursive: true, force: true });
      }
    });
  });
});

describe('appendDurableEvent — write-through indexing', () => {
  let savedLaceDir: string | undefined;
  let laceDir: string;
  let sessionDir: string;
  let sessionId: string;

  beforeEach(() => {
    savedLaceDir = process.env.LACE_DIR;
    laceDir = mkdtempSync(join(tmpdir(), 'recall-writethru-'));
    sessionId = `sess_${randomUUID()}`;
    sessionDir = join(laceDir, 'agent-sessions', sessionId);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, 'meta.json'),
      JSON.stringify({
        sessionId,
        workDir: laceDir,
        created: new Date().toISOString(),
        persona: 'ada',
      })
    );
    process.env.LACE_DIR = laceDir;
    invalidatePersonaCache();
  });

  afterEach(() => {
    closeRecallIndex();
    if (savedLaceDir === undefined) {
      delete process.env.LACE_DIR;
    } else {
      process.env.LACE_DIR = savedLaceDir;
    }
    rmSync(laceDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('indexes a prompt event into FTS with the session persona', () => {
    const startState = { nextEventSeq: 1, nextStreamSeq: 1 };
    const { written } = appendDurableEvent(sessionDir, startState, {
      type: 'prompt',
      data: { type: 'prompt', content: [{ type: 'text', text: 'hello world' }] },
    });

    // Filter by this session's id so we don't conflict with earlier tests
    // that share the singleton FTS index for the test process.
    const db = getRecallIndex();
    const rows = db
      .prepare(
        `SELECT event_id, session_id, persona, kind, content FROM events WHERE session_id = ?`
      )
      .all(sessionId) as Array<Record<string, unknown>>;
    expect(rows).toEqual([
      {
        event_id: `${sessionId}:${written.eventSeq}`,
        session_id: sessionId,
        persona: 'ada',
        kind: 'user_message',
        content: 'hello world',
      },
    ]);
  });

  it('skips events that eventToRow returns null for (e.g. turn_start)', () => {
    const startState = { nextEventSeq: 1, nextStreamSeq: 1 };
    appendDurableEvent(sessionDir, startState, { type: 'turn_start', data: {} });

    const db = getRecallIndex();
    const count = (
      db.prepare(`SELECT COUNT(*) AS n FROM events WHERE session_id = ?`).get(sessionId) as {
        n: number;
      }
    ).n;
    expect(count).toBe(0);
  });

  it('event-write still succeeds when the indexer throws', () => {
    // Make sure the singleton instance is open BEFORE we mock prepare so the
    // open path isn't what fails. Then break prepare on the live handle so
    // insertRow throws.
    const db = getRecallIndex();
    const originalPrepare = db.prepare.bind(db);
    vi.spyOn(db, 'prepare').mockImplementation(() => {
      throw new Error('synthetic FTS prepare failure');
    });
    // Swallow the recall error log so test output stays pristine.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const startState = { nextEventSeq: 1, nextStreamSeq: 1 };
    expect(() =>
      appendDurableEvent(sessionDir, startState, {
        type: 'prompt',
        data: { type: 'prompt', content: [{ type: 'text', text: 'survives indexer failure' }] },
      })
    ).not.toThrow();

    // The event must have landed in JSONL even though FTS failed.
    const read = readDurableEvents(sessionDir, { afterEventSeq: 0, limit: 100 });
    expect(read.events).toHaveLength(1);
    expect(read.events[0]?.type).toBe('prompt');
    expect(errSpy).toHaveBeenCalled();

    // Restore prepare on the same handle so afterEach close() doesn't trip.
    (db.prepare as unknown as { mockRestore?: () => void }).mockRestore?.();
    // Sanity: we can read from the live handle after restore.
    expect(() => originalPrepare(`SELECT 1`).get()).not.toThrow();
  });
});
