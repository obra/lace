// ABOUTME: Integration tests for the job stall detector: a running job whose
// output file stops growing for STALL threshold produces exactly one
// <notification kind="job-stalled"> inject without any caller polling, re-arms
// when output resumes, and never fires after the job leaves 'running'.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { JobManager } from '../job-manager';
import { createQueueJobNotification, createSetupStallTimer } from '../job-notifications';
import { DEFAULT_STALL_THRESHOLD_MS } from '../../server-types';
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

function makeRunningJob(jobId: string, outputDir: string): JobState {
  const outputPath = join(outputDir, `${jobId}.log`);
  writeFileSync(outputPath, 'started\n');
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

function readStallInjects(sessionDir: string): string[] {
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
        if (block.text.includes('kind="job-stalled"')) texts.push(block.text);
      }
    }
  }
  return texts;
}

describe('job stall detection', () => {
  let outputDir: string;
  let laceDir: string;
  let sessionDir: string;
  let savedLaceDir: string | undefined;

  beforeEach(() => {
    outputDir = mkdtempSync(join(tmpdir(), 'lace-stall-output-'));
    laceDir = mkdtempSync(join(tmpdir(), 'lace-stall-session-'));
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

  function arm(job: JobState): { jobManager: JobManager } {
    const jobManager = makeJobManager();
    const state = makeStateStub(jobManager, sessionDir);
    const runPromptInternalRef = { current: null };
    const queue = createQueueJobNotification(state, runPromptInternalRef);
    const setupStallTimer = createSetupStallTimer(queue);
    setupStallTimer(job);
    return { jobManager };
  }

  it('fires exactly one job-stalled notification when output is quiet past the threshold', () => {
    const job = makeRunningJob('job_s1', outputDir);
    arm(job);

    vi.advanceTimersByTime(DEFAULT_STALL_THRESHOLD_MS + 61_000);

    const stalls = readStallInjects(sessionDir);
    expect(stalls).toHaveLength(1);
    expect(stalls[0]).toContain('job_s1');

    // Still quiet: no further notifications for the same stall episode.
    vi.advanceTimersByTime(DEFAULT_STALL_THRESHOLD_MS);
    expect(readStallInjects(sessionDir)).toHaveLength(1);
  });

  it('output growth resets the stall clock', () => {
    const job = makeRunningJob('job_s2', outputDir);
    arm(job);

    // Quiet for most of the threshold, then output resumes.
    vi.advanceTimersByTime(DEFAULT_STALL_THRESHOLD_MS - 60_000);
    appendFileSync(job.outputPath, 'more output\n');
    // Another near-threshold quiet stretch: still no stall (clock was reset).
    vi.advanceTimersByTime(DEFAULT_STALL_THRESHOLD_MS - 60_000);
    expect(readStallInjects(sessionDir)).toHaveLength(0);

    // Now let it go fully quiet past the threshold.
    vi.advanceTimersByTime(DEFAULT_STALL_THRESHOLD_MS + 61_000);
    expect(readStallInjects(sessionDir)).toHaveLength(1);
  });

  it('re-arms after output resumes so a second stall episode fires again', () => {
    const job = makeRunningJob('job_s3', outputDir);
    arm(job);

    vi.advanceTimersByTime(DEFAULT_STALL_THRESHOLD_MS + 61_000);
    expect(readStallInjects(sessionDir)).toHaveLength(1);

    appendFileSync(job.outputPath, 'woke up\n');
    vi.advanceTimersByTime(DEFAULT_STALL_THRESHOLD_MS + 61_000);
    expect(readStallInjects(sessionDir)).toHaveLength(2);
  });

  it('never fires once the job leaves running', () => {
    const job = makeRunningJob('job_s4', outputDir);
    arm(job);

    job.status = 'completed';
    vi.advanceTimersByTime(DEFAULT_STALL_THRESHOLD_MS * 3);
    expect(readStallInjects(sessionDir)).toHaveLength(0);
    expect(job.stallTimer).toBeUndefined();
  });

  it('delivers stalled even when only a progress subscription exists', () => {
    const job = makeRunningJob('job_s5', outputDir);
    const { jobManager } = arm(job);
    jobManager.subscribe({ jobId: 'job_s5', on: ['progress'] });

    vi.advanceTimersByTime(DEFAULT_STALL_THRESHOLD_MS + 61_000);
    expect(readStallInjects(sessionDir)).toHaveLength(1);
  });
});
