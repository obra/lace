// ABOUTME: Integration test for the createSetupProgressTimer →
// queueJobNotification → fanoutToInject path for `progress` notifications
// (PRI-1692 Phase 2, PRI-1744). Spins up the real createQueueJobNotification
// factory used by server.ts and verifies that progress notifications route
// through the subscription registry, that the subscriber-side filter regex is
// applied against the preview text, and that jobs with no subscribers still
// fall back to the always-on inject (back-compat with Phase 1).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { JobManager } from '../job-manager';
import { createQueueJobNotification, createSetupProgressTimer } from '../job-notifications';
import type { AgentServerState, JobState } from '../../server-types';
import { invalidatePersonaCache, readDurableEvents } from '@lace/agent/storage/event-log';

function makeJobManager(): JobManager {
  return new JobManager({
    getActiveSession: vi.fn().mockReturnValue({ sessionId: 'sess_1', dir: '/tmp/sess' }),
    persistEvent: vi.fn(),
    emitUpdate: vi.fn(),
    runShellProcess: vi.fn(),
    runSubagentProcess: vi.fn(),
  });
}

function makeStateStub(jobManager: JobManager, sessionDir: string): AgentServerState {
  return {
    activeTurn: null,
    activeSession: { meta: { sessionId: 'sess_1' }, dir: sessionDir },
    jobManager,
  } as unknown as AgentServerState;
}

/**
 * createQueueJobNotification reads the on-disk job output to populate
 * `lastLines`, which becomes the filter target. Use a real tempfile so the
 * preview is actually populated.
 */
function makeJobStateWithOutput(jobId: string, outputDir: string, output: string): JobState {
  const outputPath = join(outputDir, `${jobId}.log`);
  writeFileSync(outputPath, output);
  return {
    jobId,
    type: 'bash',
    status: 'running',
    startedAt: new Date(Date.now() - 1000).toISOString(),
    outputPath,
    finished: false,
    completion: Promise.resolve(),
    resolveCompletion: () => {},
  } as JobState;
}

function readInjectedTexts(sessionDir: string): string[] {
  const { events } = readDurableEvents(sessionDir, {});
  const texts: string[] = [];
  for (const evt of events) {
    if (evt.type !== 'context_injected') continue;
    const data = evt.data as {
      priority?: string;
      content?: Array<{ type?: string; text?: string }>;
    };
    if (data.priority !== 'immediate') continue;
    for (const block of data.content ?? []) {
      if (block.type === 'text' && typeof block.text === 'string') {
        texts.push(block.text);
      }
    }
  }
  return texts;
}

describe('progress fanout integration (PRI-1692 Phase 2, PRI-1744)', () => {
  let outputDir: string;
  let laceDir: string;
  let sessionDir: string;
  let savedLaceDir: string | undefined;

  beforeEach(() => {
    outputDir = mkdtempSync(join(tmpdir(), 'lace-progress-output-'));
    laceDir = mkdtempSync(join(tmpdir(), 'lace-progress-session-'));
    const sessionId = `sess_${randomUUID()}`;
    sessionDir = join(laceDir, 'agent-sessions', sessionId);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, 'meta.json'),
      JSON.stringify({
        sessionId,
        workDir: laceDir,
        created: new Date().toISOString(),
        persona: 'test',
      })
    );
    savedLaceDir = process.env.LACE_DIR;
    process.env.LACE_DIR = laceDir;
    invalidatePersonaCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (savedLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = savedLaceDir;
    rmSync(outputDir, { recursive: true, force: true });
    rmSync(laceDir, { recursive: true, force: true });
  });

  it('subscribed progress routes through fanout and batches; filter is applied to the preview', () => {
    const jobManager = makeJobManager();

    // Subscribe to progress with a filter that matches "ERROR:" anywhere
    // (multi-line). Two fires: one with no ERROR (dropped by filter), one
    // with ERROR (passes filter, then coalesced through the 200ms window).
    jobManager.subscribe({
      jobId: 'job_p',
      on: ['progress'],
      filter: '^ERROR:',
    });

    const state = makeStateStub(jobManager, sessionDir);
    const queueJobNotification = createQueueJobNotification(state, { current: null });

    queueJobNotification(
      makeJobStateWithOutput('job_p', outputDir, 'starting\ninfo: doing work\nstill working\n'),
      'progress',
      { deltaBytes: 30 }
    );
    queueJobNotification(
      makeJobStateWithOutput('job_p', outputDir, 'starting\nERROR: bad thing happened\n'),
      'progress',
      { deltaBytes: 30 }
    );
    vi.advanceTimersByTime(250);

    // Filter dropped the first fire; the second one was batched and flushed
    // after 200ms. Exactly one context_injected event lands.
    const texts = readInjectedTexts(sessionDir);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain('<notification kind="job-progress"');
    expect(texts[0]).toContain('ERROR: bad thing happened');
  });

  it('PRI-1707 end-to-end: opt-in arm via subscribe → real timer fires → fanout delivers a notification', () => {
    // Wire JobManager to the REAL createSetupProgressTimer + queueJobNotification
    // so a single subscribe(on=['progress']) round-trip arms a real interval,
    // fires it once, and routes a notification through the fanoutToInject path.
    const jobManager = new JobManager({
      getActiveSession: vi.fn().mockReturnValue({ sessionId: 'sess_1', dir: sessionDir }),
      persistEvent: vi.fn(),
      emitUpdate: vi.fn(),
      runShellProcess: vi.fn(),
      runSubagentProcess: vi.fn(),
    });
    const state = makeStateStub(jobManager, sessionDir);
    const queueJobNotification = createQueueJobNotification(state, { current: null });
    const setupProgressTimer = createSetupProgressTimer(
      state,
      { current: null },
      queueJobNotification
    );

    // Manually register the job in the manager and write its output file
    // so the timer's stat() succeeds and the preview is non-empty.
    const jobId = 'job_e2e';
    const outputPath = join(outputDir, `${jobId}.log`);
    writeFileSync(outputPath, 'in-progress output\n');
    const job: JobState = {
      jobId,
      type: 'delegate',
      status: 'running',
      startedAt: new Date().toISOString(),
      outputPath,
      finished: false,
      completion: Promise.resolve(),
      resolveCompletion: () => {},
    };
    jobManager.addJob(job);

    // Replace the dep so subscribe-driven arming uses the real wiring.
    // (addJob was registered against the JobManager constructed above; we
    // didn't pass setupProgressTimer in deps, so monkey-patch it here.)
    (
      jobManager as unknown as { deps: { setupProgressTimer: typeof setupProgressTimer } }
    ).deps.setupProgressTimer = setupProgressTimer;

    jobManager.subscribe({ jobId, on: ['progress'] });
    expect(job.progressTimer).toBeDefined();

    // Drive one tick of the real progress timer (default 5 minutes), then
    // drain the 200ms batching window. Exactly one context_injected event
    // should land carrying the preview text in its body.
    vi.advanceTimersByTime(300000);
    vi.advanceTimersByTime(250);

    const texts = readInjectedTexts(sessionDir);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain('<notification kind="job-progress"');
    expect(texts[0]).toContain('in-progress output');
  });

  it('unsubscribed progress: always-on fallback inject fires immediately (no batching)', () => {
    const jobManager = makeJobManager();
    // No subscription for this jobId.
    const state = makeStateStub(jobManager, sessionDir);
    const queueJobNotification = createQueueJobNotification(state, { current: null });

    queueJobNotification(makeJobStateWithOutput('job_unsub', outputDir, 'line\n'), 'progress', {
      deltaBytes: 5,
    });

    // Fallback fires immediately — no 200ms wait, no fanout-driven batching.
    const texts = readInjectedTexts(sessionDir);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain('<notification kind="job-progress"');
  });
});
