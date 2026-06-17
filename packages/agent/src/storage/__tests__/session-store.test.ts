import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { join } from 'node:path';
import {
  ensureSessionFiles,
  getSessionDir,
  listSessions,
  loadSession,
  readSessionMeta,
  readSessionState,
  writeSessionMeta,
  writeSessionState,
} from '../session-store';
import { deriveNextEventSeqFromEventLog } from '../event-log';
import { fsOps } from '../atomic-write';

// Valid session ID format: sess_<uuid>
const TEST_SESSION_ID = 'sess_550e8400-e29b-41d4-a716-446655440000';

describe('storage/session-store', () => {
  let originalLaceDir: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    tempDir = mkdtempSync(join(tmpdir(), 'lace-session-store-'));
    process.env.LACE_DIR = tempDir;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = originalLaceDir;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates predictable session paths under lace dir', () => {
    const dir = getSessionDir(TEST_SESSION_ID);
    expect(dir).toBe(join(tempDir, 'agent-sessions', TEST_SESSION_ID));
    expect(existsSync(join(tempDir, 'agent-sessions'))).toBe(true);
  });

  it('falls back to XDG_STATE_HOME when LACE_DIR is not writable', () => {
    const xdg = mkdtempSync(join(tmpdir(), 'lace-session-xdg-'));
    const originalXdg = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = xdg;

    // Make LACE_DIR effectively read-only so mkdir(agent-sessions) fails.
    chmodSync(tempDir, 0o500);

    try {
      const dir = getSessionDir(TEST_SESSION_ID);
      expect(dir).toBe(join(xdg, 'lace', 'agent-sessions', TEST_SESSION_ID));
      expect(existsSync(join(xdg, 'lace', 'agent-sessions'))).toBe(true);
    } finally {
      // restore so afterEach can remove tempDir
      chmodSync(tempDir, 0o700);
      if (originalXdg === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = originalXdg;
      rmSync(xdg, { recursive: true, force: true });
    }
  });

  it('defaults state when missing, and persists state.json', () => {
    const sessionDir = getSessionDir(TEST_SESSION_ID);
    const initial = readSessionState(sessionDir);
    expect(initial).toEqual({ nextEventSeq: 1, nextStreamSeq: 1 });

    writeSessionState(sessionDir, {
      nextEventSeq: 7,
      nextStreamSeq: 9,
      config: { approvalMode: 'ask' },
    });

    const roundTrip = readSessionState(sessionDir);
    expect(roundTrip.nextEventSeq).toBe(7);
    expect(roundTrip.nextStreamSeq).toBe(9);
    expect(roundTrip.config).toMatchObject({ approvalMode: 'ask' });
  });

  it('throws on a corrupt state.json instead of silently returning a config-less default', () => {
    // An existing-but-unparseable state.json must NOT collapse to the
    // new-session default. If it did, a subsequent loadSession write would
    // persist that config-less state over the real one — dropping modelId /
    // connectionId and wedging every future turn (the failure can only call
    // the provider once those are present). Fail loud so the caller stops
    // rather than clobbering recoverable state.
    const sessionDir = getSessionDir(TEST_SESSION_ID);
    // Seed a real, rich state first so we can assert it would otherwise be lost.
    writeSessionState(sessionDir, {
      nextEventSeq: 42,
      nextStreamSeq: 5,
      config: { modelId: 'claude-opus-4-8', connectionId: 'sen-anthropic' },
    });
    // Corrupt it (simulate a torn/garbled file).
    writeFileSync(join(sessionDir, 'state.json'), '{ this is not valid json ', 'utf8');

    expect(() => readSessionState(sessionDir)).toThrow(/corrupt|state\.json/i);
  });

  it('still defaults to a fresh state when state.json is genuinely absent (ENOENT)', () => {
    // The new-session path must keep working: no state.json at all → defaults.
    const sessionDir = getSessionDir('sess_550e8400-e29b-41d4-a716-446655440099');
    mkdirSync(sessionDir, { recursive: true });
    expect(readSessionState(sessionDir)).toEqual({ nextEventSeq: 1, nextStreamSeq: 1 });
  });

  it('round-trips highestFiredBreakpointAt', () => {
    const sessionDir = getSessionDir(TEST_SESSION_ID);

    // Initially undefined
    const initial = readSessionState(sessionDir);
    expect(initial.highestFiredBreakpointAt).toBeUndefined();

    // Write a non-zero value
    writeSessionState(sessionDir, {
      nextEventSeq: 1,
      nextStreamSeq: 1,
      highestFiredBreakpointAt: 0.6,
    });

    const afterWrite = readSessionState(sessionDir);
    expect(afterWrite.highestFiredBreakpointAt).toBe(0.6);

    // Reset to 0
    writeSessionState(sessionDir, {
      nextEventSeq: 1,
      nextStreamSeq: 1,
      highestFiredBreakpointAt: 0,
    });

    const afterReset = readSessionState(sessionDir);
    expect(afterReset.highestFiredBreakpointAt).toBe(0);
  });

  it('reads highestFiredBreakpointAt as undefined from a legacy state.json without the field', () => {
    const sessionDir = getSessionDir(TEST_SESSION_ID);
    // Write a state.json that has no highestFiredBreakpointAt (simulates old files)
    writeSessionState(sessionDir, { nextEventSeq: 3, nextStreamSeq: 2 });
    const state = readSessionState(sessionDir);
    expect(state.highestFiredBreakpointAt).toBeUndefined();
  });

  it('persists runtimeBinding under state.config.runtimeBinding', () => {
    const sessionDir = join(tempDir, 'sess_runtime_binding');
    writeSessionMeta(sessionDir, {
      sessionId: 'sess_runtime_binding',
      workDir: '/repo',
      created: '2026-05-20T00:00:00.000Z',
    });

    writeSessionState(sessionDir, {
      nextEventSeq: 1,
      nextStreamSeq: 1,
      config: {
        runtimeBinding: {
          schemaVersion: 1,
          identity: { runtimeId: 'rt_test' },
          toolRuntime: { type: 'boundedHost', root: '/repo', cwd: '/repo' },
        },
      },
    });

    expect(readSessionState(sessionDir).config?.runtimeBinding).toEqual({
      schemaVersion: 1,
      identity: { runtimeId: 'rt_test' },
      toolRuntime: { type: 'boundedHost', root: '/repo', cwd: '/repo' },
    });
  });

  it('writes state.json atomically (temp file + rename; no partial writes to target)', () => {
    const sessionDir = getSessionDir(TEST_SESSION_ID);

    // Start with an existing valid file so we can ensure it's not modified
    // until the final rename step.
    const statePath = join(sessionDir, 'state.json');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      statePath,
      JSON.stringify({ nextEventSeq: 1, nextStreamSeq: 1 }, null, 2),
      'utf8'
    );

    const writes: string[] = [];
    const renames: Array<{ from: string; to: string }> = [];

    const originalWriteFileSync = fsOps.writeFileSync;
    vi.spyOn(fsOps, 'writeFileSync').mockImplementation((file, data, options) => {
      const filePath = String(file);
      writes.push(filePath);

      // If we ever attempt to write directly to the final file path,
      // fail the test. Atomic writes must write to a temp file in the same dir.
      if (path.resolve(filePath) === path.resolve(statePath)) {
        throw new Error(`Non-atomic write: attempted writeFileSync(${filePath})`);
      }

      return (originalWriteFileSync as any)(file as any, data as any, options as any);
    });

    const originalRenameSync = fsOps.renameSync;
    vi.spyOn(fsOps, 'renameSync').mockImplementation((from, to) => {
      renames.push({ from: String(from), to: String(to) });

      // The existing state.json should remain parseable right up until we swap it.
      expect(() => JSON.parse(readFileSync(statePath, 'utf8'))).not.toThrow();

      return (originalRenameSync as any)(from as any, to as any);
    });

    writeSessionState(sessionDir, {
      nextEventSeq: 2,
      nextStreamSeq: 3,
      config: { approvalMode: 'ask' },
    });

    expect(writes.length).toBeGreaterThan(0);
    expect(writes.some((p) => path.resolve(p) === path.resolve(statePath))).toBe(false);

    expect(renames).toHaveLength(1);
    expect(path.resolve(renames[0].to)).toBe(path.resolve(statePath));

    const finalState = JSON.parse(readFileSync(statePath, 'utf8'));
    expect(finalState).toMatchObject({ nextEventSeq: 2, nextStreamSeq: 3 });
  });

  it('writes meta, does not pre-create empty events.jsonl, lists and loads sessions', () => {
    const sessionDir = getSessionDir(TEST_SESSION_ID);
    writeSessionMeta(sessionDir, {
      sessionId: TEST_SESSION_ID,
      workDir: '/tmp',
      created: '2026-01-04T00:00:00Z',
    });
    ensureSessionFiles(sessionDir);

    expect(existsSync(join(sessionDir, 'meta.json'))).toBe(true);
    // Post-migration, new sessions must NOT have an empty legacy events.jsonl
    // — writes go under transcripts/<persona>/<date>/<session>.jsonl instead.
    expect(existsSync(join(sessionDir, 'events.jsonl'))).toBe(false);

    const sessions = listSessions('/tmp');
    expect(sessions).toMatchObject([{ sessionId: TEST_SESSION_ID, cwd: '/tmp' }]);

    const loaded = loadSession(TEST_SESSION_ID);
    expect(loaded.meta.sessionId).toBe(TEST_SESSION_ID);
    expect(loaded.meta.workDir).toBe('/tmp');
  });

  it('derives lastActive and messageCount from durable events', () => {
    const sessionDir = getSessionDir(TEST_SESSION_ID);
    writeSessionMeta(sessionDir, {
      sessionId: TEST_SESSION_ID,
      workDir: '/tmp',
      created: '2026-01-04T00:00:00Z',
    });
    ensureSessionFiles(sessionDir);

    const eventsPath = join(sessionDir, 'events.jsonl');
    const lines = [
      {
        eventSeq: 1,
        timestamp: '2026-01-04T00:00:01Z',
        type: 'prompt',
        data: { content: [{ type: 'text', text: 'hi' }] },
      },
      {
        eventSeq: 2,
        timestamp: '2026-01-04T00:00:02Z',
        type: 'message',
        data: { content: 'hello' },
      },
      {
        eventSeq: 3,
        timestamp: '2026-01-04T00:00:03Z',
        type: 'turn_end',
        data: { stopReason: 'end_turn' },
      },
    ];
    writeFileSync(eventsPath, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`, 'utf8');

    const sessions = listSessions('/tmp');
    expect(sessions).toMatchObject([
      {
        sessionId: TEST_SESSION_ID,
        messageCount: 2,
        updatedAt: '2026-01-04T00:00:03Z',
      },
    ]);
  });

  it('round-trips persona through write/read of session meta', () => {
    const sessionDir = getSessionDir(TEST_SESSION_ID);
    writeSessionMeta(sessionDir, {
      sessionId: TEST_SESSION_ID,
      workDir: '/tmp',
      created: '2026-01-04T00:00:00Z',
      persona: 'ada',
    });

    const read = readSessionMeta(sessionDir);
    expect(read.persona).toBe('ada');
  });

  it('reads meta with no persona field as persona=undefined (back-compat)', () => {
    const sessionDir = getSessionDir(TEST_SESSION_ID);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, 'meta.json'),
      JSON.stringify({
        sessionId: TEST_SESSION_ID,
        workDir: '/tmp',
        created: '2026-01-04T00:00:00Z',
      }),
      'utf8'
    );

    const read = readSessionMeta(sessionDir);
    expect(read.persona).toBeUndefined();
  });

  it('derives nextEventSeq from durable event log even when final JSONL line is truncated', () => {
    const sessionDir = getSessionDir(TEST_SESSION_ID);
    writeSessionMeta(sessionDir, {
      sessionId: TEST_SESSION_ID,
      workDir: '/tmp',
      created: '2026-01-04T00:00:00Z',
    });
    ensureSessionFiles(sessionDir);

    const eventsPath = join(sessionDir, 'events.jsonl');

    const lines = [
      {
        eventSeq: 1,
        timestamp: '2026-01-04T00:00:01Z',
        type: 'prompt',
        data: { content: [{ type: 'text', text: 'hi' }] },
      },
      {
        eventSeq: 2,
        timestamp: '2026-01-04T00:00:02Z',
        type: 'message',
        data: { content: 'hello' },
      },
      {
        eventSeq: 3,
        timestamp: '2026-01-04T00:00:03Z',
        type: 'turn_end',
        data: { stopReason: 'end_turn' },
      },
    ];

    const truncatedLine =
      '{"eventSeq":4,"timestamp":"2026-01-04T00:00:04Z","type":"message","data":';
    writeFileSync(
      eventsPath,
      `${lines.map((l) => JSON.stringify(l)).join('\n')}\n${truncatedLine}`,
      'utf8'
    );

    expect(deriveNextEventSeqFromEventLog(sessionDir)).toBe(4);
  });
});
