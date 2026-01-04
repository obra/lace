import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
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
    const dir = getSessionDir('sess_test');
    expect(dir).toBe(join(tempDir, 'agent-sessions', 'sess_test'));
    expect(existsSync(join(tempDir, 'agent-sessions'))).toBe(true);
  });

  it('defaults state when missing, and persists state.json', () => {
    const sessionDir = getSessionDir('sess_test');
    const initial = readSessionState(sessionDir);
    expect(initial).toEqual({ nextEventSeq: 1, nextStreamSeq: 1, pendingPermissions: [] });

    writeSessionState(sessionDir, {
      nextEventSeq: 7,
      nextStreamSeq: 9,
      pendingPermissions: [
        {
          toolCallId: 'tool_1',
          turnId: 'turn_1',
          turnSeq: 1,
          tool: 'file_write',
          resource: 'file:/tmp/out.txt',
          options: [{ optionId: 'allow', label: 'Allow' }],
          requestedAt: '2026-01-04T00:00:00Z',
          input: { path: 'out.txt' },
        },
      ],
      config: { approvalMode: 'ask' },
    });

    const roundTrip = readSessionState(sessionDir);
    expect(roundTrip.nextEventSeq).toBe(7);
    expect(roundTrip.nextStreamSeq).toBe(9);
    expect(roundTrip.config).toMatchObject({ approvalMode: 'ask' });
    expect(roundTrip.pendingPermissions?.[0]).toMatchObject({ tool: 'file_write' });
  });

  it('writes meta, ensures events.jsonl, lists and loads sessions', () => {
    const sessionDir = getSessionDir('sess_test');
    writeSessionMeta(sessionDir, {
      sessionId: 'sess_test',
      workDir: '/tmp',
      created: '2026-01-04T00:00:00Z',
    });
    ensureSessionFiles(sessionDir);

    expect(existsSync(join(sessionDir, 'meta.json'))).toBe(true);
    expect(existsSync(join(sessionDir, 'events.jsonl'))).toBe(true);
    expect(readFileSync(join(sessionDir, 'events.jsonl'), 'utf8')).toBe('');

    const sessions = listSessions('/tmp');
    expect(sessions).toMatchObject([{ sessionId: 'sess_test', workDir: '/tmp' }]);

    const loaded = loadSession('sess_test');
    expect(loaded.meta.sessionId).toBe('sess_test');
    expect(loaded.meta.workDir).toBe('/tmp');
  });

  it('derives lastActive and messageCount from durable events', () => {
    const sessionDir = getSessionDir('sess_test');
    writeSessionMeta(sessionDir, {
      sessionId: 'sess_test',
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
        sessionId: 'sess_test',
        messageCount: 2,
        lastActive: '2026-01-04T00:00:03Z',
      },
    ]);
  });
});
