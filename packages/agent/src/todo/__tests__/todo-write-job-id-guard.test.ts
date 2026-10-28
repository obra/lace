// ABOUTME: Tests for PRI-3362's todo_write guard — refuses a job_<uuid> id this
// ABOUTME: session's JobManager has never returned, the shape of a job id composed
// ABOUTME: before the delegate/bash(background=true) call that creates it returns.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { executeTodoWrite } from '../todo-tools';
import { JobManager } from '../../jobs/job-manager';
import type { JobManagerDeps } from '../../jobs/job-manager';

// A job_<uuid> that was never minted by any JobManager in this file — used as
// the "invented id" an agent composes before a delegate/bash call returns.
const INVENTED_JOB_ID = 'job_8a0bfabf-1a19-4e0b-bc14-07e5e4ded12d';

// Builds a real JobManager backed by the real <sessionDir>/events.jsonl path
// readAllSessionEventLines() reads (storage/event-log.ts). persistEvent
// actually appends a durable line — not a no-op — so listJobs() on a FRESH
// JobManager instance over the same sessionDir (case 4: compaction/restart)
// really does rebuild from disk, the same as production.
let eventSeq = 0;
function newRealJobManager(sessionDir: string): JobManager {
  const deps: JobManagerDeps = {
    getActiveSession: () => ({ sessionId: 'sess_test', dir: sessionDir }),
    persistEvent: (event) =>
      new Promise((resolve) => {
        // Real createJob() awaits persistEvent before returning (job-manager.ts).
        // setImmediate forces a genuine async hop here so the batch-ordering
        // test below only passes if executeTodoWrite runs *after* createJob's
        // promise (and this await) has fully settled — the guarantee
        // runner.ts's sequential tool-call loop provides, not an artifact of a
        // synchronous mock.
        setImmediate(() => {
          eventSeq += 1;
          appendFileSync(
            join(sessionDir, 'events.jsonl'),
            JSON.stringify({
              eventSeq,
              timestamp: new Date().toISOString(),
              type: event.type,
              data: event.data,
            }) + '\n'
          );
          resolve();
        });
      }),
    emitUpdate: () => Promise.resolve(),
    runShellProcess: vi.fn(),
    runSubagentProcess: vi.fn(),
  };
  return new JobManager(deps);
}

describe('PRI-3362: todo_write refuses an uncited job id', () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = mkdtempSync(join(tmpdir(), 'todo-job-id-guard-'));
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  // Case 1: an invented job id is rejected and nothing is written.
  it('rejects a description citing a job id no tool in this session has returned', async () => {
    const jobManager = newRealJobManager(sessionDir);

    const result = await executeTodoWrite(
      {
        title: 'Wait for worker',
        description: `Watch ${INVENTED_JOB_ID} for results`,
      },
      { sessionDir, jobManager }
    );

    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain(INVENTED_JOB_ID);
    expect(result.content[0].text).toContain('todo_write refused');
    expect(result.content[0].text).toContain('jobs_list');

    // Nothing was written — a rejected call must not leave a partial todo.
    expect(existsSync(join(sessionDir, 'todo.md'))).toBe(false);
  });

  // Case 1b: when the session has real jobs, the refusal names the five most
  // recent of them (like job_notify/job_output/job_kill's refusal), so the
  // caller can pick the id it meant without a separate jobs_list call.
  it("names the session's real recent jobs in the refusal", async () => {
    const jobManager = newRealJobManager(sessionDir);
    const { jobId: realJobId } = await jobManager.createJob('delegate', {
      prompt: 'earlier real work',
    });

    const result = await executeTodoWrite(
      {
        title: 'Wait for worker',
        description: `Watch ${INVENTED_JOB_ID} for results`,
      },
      { sessionDir, jobManager }
    );

    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain(realJobId);
  });

  // Case 2: an id returned by an earlier delegate/bash(background=true) call
  // THIS session actually made is accepted.
  it('accepts a job id this session actually returned earlier', async () => {
    const jobManager = newRealJobManager(sessionDir);
    const { jobId: realJobId } = await jobManager.createJob('delegate', {
      prompt: 'do some work',
    });

    const result = await executeTodoWrite(
      {
        title: 'Wait for worker',
        description: `Watch ${realJobId} for results`,
      },
      { sessionDir, jobManager }
    );

    expect(result.status).toBe('completed');
    expect(existsSync(join(sessionDir, 'todo.md'))).toBe(true);
    expect(readFileSync(join(sessionDir, 'todo.md'), 'utf-8')).toContain(realJobId);
  });

  // Case 2b: a real id cited in a different case is still accepted. The id
  // regex matches job ids case-insensitively, but a JobManager always issues
  // lower-case ids (randomUUID()'s output), so a bare case-sensitive lookup
  // would wrongly refuse an upper-cased real id.
  it('accepts a real job id even when cited in a different case', async () => {
    const jobManager = newRealJobManager(sessionDir);
    const { jobId: realJobId } = await jobManager.createJob('delegate', {
      prompt: 'do some work',
    });

    const result = await executeTodoWrite(
      {
        title: 'Wait for worker',
        description: `Watch ${realJobId.toUpperCase()} for results`,
      },
      { sessionDir, jobManager }
    );

    expect(result.status).toBe('completed');
  });

  // Case 3: the actual failure mode — a delegate (or bash background) call and
  // a todo_write landing in the same tool-call batch. lace's "parallel"
  // tool-call batch is parallel only from the MODEL's perspective: it emits
  // several tool_use blocks in one turn without having seen any result yet.
  // At runtime, core/conversation/runner.ts executes that batch strictly
  // sequentially — `for (const toolCall of toolCalls) { await
  // this.executeToolCall(...) }`, never Promise.all — so by the time a later
  // call in the array runs, every earlier call's promise (including its
  // internal awaits) has already settled. This test pins that: it awaits the
  // delegate-equivalent call to completion before calling executeTodoWrite,
  // exactly mirroring one iteration of that loop finishing before the next
  // starts. If that loop ever became concurrent, this ordering guarantee
  // (and the guard's correctness for the common "delegate, then todo_write"
  // ordering) would need re-verifying.
  describe('same-batch ordering (delegate call, then todo_write)', () => {
    it('accepts the real id a same-batch delegate call just created', async () => {
      const jobManager = newRealJobManager(sessionDir);

      // Simulates the batch's first tool call: `delegate(...)`. Production
      // delegate.ts calls exactly this — jobManager.createJob('delegate', ...)
      // — and returns `{ jobId, status: 'started' }` to the model while the
      // job itself keeps running in the background (runSubagentProcess is a
      // no-op here, matching that we never need the child to actually run).
      const { jobId: realJobId } = await jobManager.createJob('delegate', {
        prompt: 'summarize the repo',
      });

      // Simulates the batch's second tool call: `todo_write(...)`, now that
      // the first call's promise (and its internal persistEvent await) has
      // fully resolved — the real sequencing runner.ts's loop guarantees.
      const result = await executeTodoWrite(
        { title: 'Wait for summary', description: `job_notify(${realJobId})` },
        { sessionDir, jobManager }
      );

      expect(result.status).toBe('completed');
    });

    it('rejects an invented id even when a real delegate call landed in the same batch', async () => {
      const jobManager = newRealJobManager(sessionDir);

      // The batch's delegate call still happens and registers its OWN real
      // id — but the todo_write call below cites a DIFFERENT, invented one
      // (the failure mode from the ticket: the model guesses before reading
      // the delegate result, so the guessed id doesn't match what came back).
      await jobManager.createJob('delegate', { prompt: 'summarize the repo' });

      const result = await executeTodoWrite(
        { title: 'Wait for summary', description: `job_notify(${INVENTED_JOB_ID})` },
        { sessionDir, jobManager }
      );

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toContain(INVENTED_JOB_ID);
    });
  });

  // Case 4: an id from before a compaction or a process restart is still
  // accepted. JobManager.listJobs() rebuilds from events.jsonl (not from the
  // LLM's context window), so it survives both. This test models that
  // directly: a FRESH JobManager instance (as a restarted/recovered process
  // would construct) reading the SAME session's existing event log still
  // knows about a job an earlier instance created.
  it('accepts an id from a prior JobManager instance over the same session (compaction/restart survivor)', async () => {
    const firstJobManager = newRealJobManager(sessionDir);
    const { jobId: realJobId } = await firstJobManager.createJob('delegate', {
      prompt: 'long task',
    });

    // A new JobManager over the same sessionDir — standing in for a
    // compaction (which touches the LLM context, not events.jsonl) or a
    // process restart (which rebuilds JobManager from the durable log).
    const secondJobManager = newRealJobManager(sessionDir);

    const result = await executeTodoWrite(
      {
        title: 'Resume after compaction',
        description: `Still waiting on ${realJobId}`,
      },
      { sessionDir, jobManager: secondJobManager }
    );

    expect(result.status).toBe('completed');
  });

  // Sanity: a job id that merely LOOKS like the pattern, but isn't a real
  // UUID shape, is left alone — this guard only ever fires on job_<uuid>.
  it('does not touch text with no job_<uuid> token', async () => {
    const jobManager = newRealJobManager(sessionDir);

    const result = await executeTodoWrite(
      { title: 'Unrelated', description: 'job_notify is not an id, just a tool name' },
      { sessionDir, jobManager }
    );

    expect(result.status).toBe('completed');
  });

  // Back-compat: call sites with no jobManager in context (existing unit
  // tests, anything that doesn't carry session job state) keep the guard
  // off rather than failing closed on a missing dependency.
  it('skips the guard entirely when context has no jobManager', async () => {
    const result = await executeTodoWrite(
      { title: 'No jobManager', description: `cites ${INVENTED_JOB_ID} but nobody is checking` },
      { sessionDir }
    );

    expect(result.status).toBe('completed');
  });

  it('randomUUID()-shaped ids really are 36 characters, matching the guard pattern', () => {
    // Pins the regex's assumption about randomUUID()'s output shape so a
    // future Node upgrade that changed it would fail loudly here, not
    // silently stop matching real job ids.
    expect(`job_${randomUUID()}`).toHaveLength(40);
  });
});
