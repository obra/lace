import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
});
