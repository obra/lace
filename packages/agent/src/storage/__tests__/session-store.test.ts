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
          agentPlacement: 'host',
          toolRuntime: { type: 'boundedHost', root: '/repo', cwd: '/repo' },
        },
      },
    });

    expect(readSessionState(sessionDir).config?.runtimeBinding).toEqual({
      schemaVersion: 1,
      identity: { runtimeId: 'rt_test' },
      agentPlacement: 'host',
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

  it('writes meta, ensures events.jsonl, lists and loads sessions', () => {
    const sessionDir = getSessionDir(TEST_SESSION_ID);
    writeSessionMeta(sessionDir, {
      sessionId: TEST_SESSION_ID,
      workDir: '/tmp',
      created: '2026-01-04T00:00:00Z',
    });
    ensureSessionFiles(sessionDir);

    expect(existsSync(join(sessionDir, 'meta.json'))).toBe(true);
    expect(existsSync(join(sessionDir, 'events.jsonl'))).toBe(true);
    expect(readFileSync(join(sessionDir, 'events.jsonl'), 'utf8')).toBe('');

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
