import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { JsonRpcPeer } from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from '../server';
import type { registerAllHandlers } from '../rpc/register-handlers';
import type { SessionUpdateParams } from '../server-types';
import { fsOps } from '../storage/atomic-write';
import { appendDurableEvent } from '../storage/event-log';
import { closeRecallIndex } from '../storage/recall/index-db';
import {
  getSessionDir,
  loadSession,
  readSessionState,
  writeSessionMeta,
  writeSessionState,
} from '../storage/session-store';
import { transcriptFilePath } from '../storage/transcript-paths';

const registeredHandlers = vi.hoisted(() => ({
  deps: undefined as Parameters<typeof registerAllHandlers>[2] | undefined,
}));

vi.mock('../rpc/register-handlers', () => ({
  registerAllHandlers: vi.fn((_peer, _state, deps) => {
    registeredHandlers.deps = deps;
  }),
}));

let laceDir: string;
const sessionId = 'sess_550e8400-e29b-41d4-a716-446655440002';
const created = '2026-05-20T00:00:00.000Z';

beforeEach(() => {
  laceDir = fs.mkdtempSync(join(tmpdir(), 'lace-server-stream-state-'));
  vi.stubEnv('LACE_DIR', laceDir);
  vi.stubEnv('LACE_SESSION_DIR', join(laceDir, 'agent-sessions'));
  registeredHandlers.deps = undefined;
  writeSessionMeta(getSessionDir(sessionId), { sessionId, workDir: laceDir, created });
  writeSessionState(getSessionDir(sessionId), { nextEventSeq: 2, nextStreamSeq: 7 });
});

afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  closeRecallIndex();
  vi.unstubAllEnvs();
  fs.rmSync(laceDir, { recursive: true, force: true });
});

it('streams ordered updates from fresh persisted state without rereading historical transcripts', async () => {
  const sessionDir = getSessionDir(sessionId);
  const history = transcriptFilePath({
    laceDir,
    persona: null,
    date: new Date(created),
    sessionId,
  });
  fs.mkdirSync(dirname(history), { recursive: true });
  fs.writeFileSync(
    history,
    JSON.stringify({ eventSeq: 1, timestamp: created, type: 'turn_start', data: {} }) + '\n'
  );

  const state = createAgentServerState();
  state.activeSession = loadSession(sessionId);
  const notifiedAt: Array<[number, number]> = [];
  const notify = vi.fn((_method: string, _params: SessionUpdateParams) => {
    const { nextEventSeq, nextStreamSeq } = readSessionState(sessionDir);
    notifiedAt.push([nextEventSeq, nextStreamSeq]);
  });
  registerAgentRpcMethods({ notify } as unknown as JsonRpcPeer, state);
  expect(registeredHandlers.deps).toBeDefined();
  const { emitSessionUpdate, runExclusive } = registeredHandlers.deps!;

  const read = vi.spyOn(fs, 'readFileSync');
  const open = vi.spyOn(fs, 'openSync');
  syncBuiltinESMExports();

  const turnId = 'turn_550e8400-e29b-41d4-a716-446655440003';
  const jobId = 'job_550e8400-e29b-41d4-a716-446655440004';
  await emitSessionUpdate({ type: 'text_delta', text: 'first' }, { turnId, turnSeq: 3 });
  expect(readSessionState(sessionDir)).toMatchObject({ nextEventSeq: 2, nextStreamSeq: 8 });
  expect(state.activeSession.state).toEqual(readSessionState(sessionDir));

  await Promise.all([
    runExclusive(() => {
      const { nextState, written } = appendDurableEvent(sessionDir, readSessionState(sessionDir), {
        type: 'message',
        data: { role: 'assistant' },
      });
      expect(written.eventSeq).toBe(2);
      writeSessionState(sessionDir, { ...nextState, sessionCostUsd: 0.25 });
    }),
    emitSessionUpdate(
      {
        type: 'job_update',
        jobId,
        jobType: 'delegate',
        channel: 'internal',
        update: { type: 'text_delta', text: 'from child' },
      },
      { turnId, turnSeq: 3 }
    ),
    emitSessionUpdate({ type: 'text_delta', text: 'third' }, { turnId, turnSeq: 4 }),
  ]);

  expect(notify.mock.calls).toEqual([
    [
      'session/update',
      expect.objectContaining({ sessionId, streamSeq: 7, turnId, turnSeq: 3, text: 'first' }),
    ],
    [
      'session/update',
      expect.objectContaining({
        sessionId,
        streamSeq: 8,
        turnId,
        turnSeq: 3,
        jobId,
        type: 'job_update',
        update: { type: 'text_delta', text: 'from child' },
      }),
    ],
    [
      'session/update',
      expect.objectContaining({ sessionId, streamSeq: 9, turnId, turnSeq: 4, text: 'third' }),
    ],
  ]);
  expect(notifiedAt).toEqual([
    [2, 7],
    [3, 8],
    [3, 9],
  ]);
  expect(readSessionState(sessionDir)).toMatchObject({
    nextEventSeq: 3,
    nextStreamSeq: 10,
    sessionCostUsd: 0.25,
  });
  expect(state.activeSession.state).toEqual(readSessionState(sessionDir));
  expect([...read.mock.calls, ...open.mock.calls].filter(([path]) => path === history)).toEqual([]);
});

it('keeps the active stream checkpoint at the last successful write when persistence fails', async () => {
  const sessionDir = getSessionDir(sessionId);
  const state = createAgentServerState();
  state.activeSession = loadSession(sessionId);
  const notify = vi.fn();
  registerAgentRpcMethods({ notify } as unknown as JsonRpcPeer, state);
  expect(registeredHandlers.deps).toBeDefined();
  const { emitSessionUpdate } = registeredHandlers.deps!;
  const error = new Error('state write failed');
  vi.spyOn(fsOps, 'renameSync').mockImplementationOnce(() => {
    throw error;
  });

  await expect(emitSessionUpdate({ type: 'text_delta', text: 'delta' })).rejects.toBe(error);
  expect(readSessionState(sessionDir).nextStreamSeq).toBe(7);
  expect(state.activeSession.state.nextStreamSeq).toBe(7);
});
