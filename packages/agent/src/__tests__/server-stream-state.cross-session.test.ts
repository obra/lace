// ABOUTME: Regression test for PRI-3774 - a job's emitSessionUpdate closure
// ABOUTME: must not mislabel updates with a session that became active later.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JsonRpcPeer } from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from '../server';
import type { registerAllHandlers } from '../rpc/register-handlers';
import type { SessionUpdateParams } from '../server-types';
import { closeRecallIndex } from '../storage/recall/index-db';
import {
  getSessionDir,
  loadSession,
  readSessionState,
  writeSessionMeta,
  writeSessionState,
} from '../storage/session-store';

const registeredHandlers = vi.hoisted(() => ({
  deps: undefined as Parameters<typeof registerAllHandlers>[2] | undefined,
}));

vi.mock('../rpc/register-handlers', () => ({
  registerAllHandlers: vi.fn((_peer, _state, deps) => {
    registeredHandlers.deps = deps;
  }),
}));

let laceDir: string;
const sessionAId = 'sess_550e8400-e29b-41d4-a716-446655440010';
const sessionBId = 'sess_550e8400-e29b-41d4-a716-446655440011';
const created = '2026-05-20T00:00:00.000Z';

beforeEach(() => {
  laceDir = fs.mkdtempSync(join(tmpdir(), 'lace-server-stream-state-cross-session-'));
  vi.stubEnv('LACE_DIR', laceDir);
  vi.stubEnv('LACE_SESSION_DIR', join(laceDir, 'agent-sessions'));
  registeredHandlers.deps = undefined;
  writeSessionMeta(getSessionDir(sessionAId), { sessionId: sessionAId, workDir: laceDir, created });
  writeSessionState(getSessionDir(sessionAId), { nextEventSeq: 1, nextStreamSeq: 1 });
  writeSessionMeta(getSessionDir(sessionBId), { sessionId: sessionBId, workDir: laceDir, created });
  writeSessionState(getSessionDir(sessionBId), { nextEventSeq: 1, nextStreamSeq: 50 });
});

afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  closeRecallIndex();
  vi.unstubAllEnvs();
  fs.rmSync(laceDir, { recursive: true, force: true });
});

/**
 * Reproduces the PRI-3774 race: a background job's emitting closure is bound
 * only to `state.activeSession` at *call* time (server.ts emitSessionUpdate,
 * reading `state.activeSession!.meta.sessionId`), not to the session that was
 * active when the job started.
 *
 * activateStoredSession (rpc/handlers/session.ts) runs releaseRunningSessionWork
 * — which calls killAllRunningJobs (jobs/job-control.ts) — BEFORE swapping
 * state.activeSession to the new session. killAllRunningJobs's killJob sends
 * SIGTERM/SIGKILL and returns once a timeout elapses; it never waits for a
 * child's already-in-flight RPC dispatch (e.g. a 'session/update' request
 * already parsed off the child's stdout pipe, mid-handler in
 * jobs/subagent-job.ts's childPeer.onRequest) to finish, and it never closes
 * job.childPeer itself. That handler's `await emitSessionUpdate(...)` call is
 * a callback captured at job start that can still be executing when the
 * active-session swap happens, with no way to know the active session moved
 * on.
 *
 * Every production call site that emits on behalf of a job (subagent-job.ts,
 * shell-job.ts, job-notifications.ts, job-manager.ts) binds `sessionId:
 * job.sessionId` in the emitSessionUpdate context — the session that was
 * active when the job was created (JobState.sessionId, server-types.ts). This
 * test drives emitSessionUpdate the same way: a job's context captures
 * session A's id at job start, but the call doesn't resolve until after
 * session B has become active - exactly what an in-flight childPeer RPC
 * dispatch surviving killJob/killAllRunningJobs looks like from
 * emitSessionUpdate's point of view.
 */
it('drops a straggling job update from session A rather than mislabeling it as session B', async () => {
  const state = createAgentServerState();
  state.activeSession = loadSession(sessionAId);
  const notify = vi.fn((_method: string, _params: SessionUpdateParams) => {});
  registerAgentRpcMethods({ notify } as unknown as JsonRpcPeer, state);
  expect(registeredHandlers.deps).toBeDefined();
  const { emitSessionUpdate } = registeredHandlers.deps!;

  const jobId = 'job_550e8400-e29b-41d4-a716-446655440020';
  // Bound once at job start, while session A is active - mirrors
  // JobState.sessionId being captured from scaffold.activeSession at job
  // creation (jobs/job-creation.ts) and threaded into every job-originated
  // emitSessionUpdate call as context.sessionId.
  const jobOwnerSessionId = state.activeSession.meta.sessionId;
  expect(jobOwnerSessionId).toBe(sessionAId);

  // Simulate killAllRunningJobs/releaseRunningSessionWork running (it kills
  // job A's process but does not await its already-dispatched RPC handler),
  // followed by activateStoredSession swapping the active session to B -
  // all while job A's straggling emitSessionUpdate call is still pending.
  const stragglingEmit = emitSessionUpdate(
    {
      type: 'job_update',
      jobId,
      jobType: 'delegate',
      channel: 'internal',
      update: { type: 'text_delta', text: 'still running in A' },
    },
    { jobId, sessionId: jobOwnerSessionId }
  );

  state.activeSession = loadSession(sessionBId);

  await stragglingEmit;

  // The bug this guards against: job A's update gets stamped with session
  // B's id and consumes session B's nextStreamSeq. The fix must neither
  // relabel it as B nor silently let it through as A once A is no longer
  // open here - it must be dropped.
  expect(notify).not.toHaveBeenCalled();

  // Session B's stream counter must be untouched by a stray update that was
  // never its own.
  expect(readSessionState(getSessionDir(sessionBId)).nextStreamSeq).toBe(50);
});
