// ABOUTME: Integration test for the createFinalizeJob → fanoutToInject →
// injectNotification path (PRI-1692 Acceptance #5, PRI-1744). Spins up a real
// JobManager and the real createQueueJobNotification factory used in
// production by server.ts, then verifies that subscribers cause the
// <notification kind="job-..."> block to be written to events.jsonl via the
// fanout path while unsubscribed jobs still get it via the always-on inject
// fallback. Wire shape stays identical between the two paths.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobManager } from '../job-manager';
import { createQueueJobNotification } from '../job-notifications';
import type { AgentServerState, JobState } from '../../server-types';

function makeJobManager(): JobManager {
  return new JobManager({
    getActiveSession: vi.fn().mockReturnValue({ sessionId: 'sess_1', dir: '/tmp/sess' }),
    persistEvent: vi.fn(),
    emitUpdate: vi.fn(),
    runShellProcess: vi.fn(),
    runSubagentProcess: vi.fn(),
  });
}

function makeJobState(jobId: string): JobState {
  return {
    jobId,
    type: 'delegate',
    status: 'completed',
    startedAt: new Date(Date.now() - 5000).toISOString(),
    outputPath: `/tmp/nonexistent-${jobId}.log`,
    finished: false,
    completion: Promise.resolve(),
    resolveCompletion: () => {},
  } as JobState;
}

/**
 * Read context_injected events from the session's events.jsonl. Returns the
 * text payloads in order — one entry per injectNotification call.
 */
function readInjectedNotificationTexts(sessionDir: string): string[] {
  const path = join(sessionDir, 'events.jsonl');
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  const texts: string[] = [];
  for (const line of lines) {
    const evt = JSON.parse(line) as {
      type?: string;
      data?: {
        priority?: string;
        content?: Array<{ type?: string; text?: string }>;
      };
    };
    if (evt.type !== 'context_injected') continue;
    if (evt.data?.priority !== 'immediate') continue;
    for (const block of evt.data.content ?? []) {
      if (block.type === 'text' && typeof block.text === 'string') {
        texts.push(block.text);
      }
    }
  }
  return texts;
}

function makeStateStub(jobManager: JobManager, sessionDir: string): AgentServerState {
  return {
    activeTurn: null,
    activeSession: { meta: { sessionId: 'sess_1' }, dir: sessionDir },
    jobManager,
  } as unknown as AgentServerState;
}

describe('createFinalizeJob → fanoutToInject integration (PRI-1744)', () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = mkdtempSync(join(tmpdir(), 'lace-fanout-inject-'));
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it('subscribed jobId: completion routes through fanout and writes one context_injected event', () => {
    const jobManager = makeJobManager();

    // Subscribe to terminal states for this job.
    jobManager.subscribe({
      jobId: 'job_subscribed',
      on: ['completed', 'failed', 'cancelled'],
    });

    const state = makeStateStub(jobManager, sessionDir);
    const queueJobNotification = createQueueJobNotification(state, { current: null });

    queueJobNotification(makeJobState('job_subscribed'), 'completed');

    const texts = readInjectedNotificationTexts(sessionDir);
    expect(texts).toHaveLength(1);
    // Wire shape: <notification kind="job-completed" job-id="..."> block.
    expect(texts[0]).toContain('<notification kind="job-completed"');
    expect(texts[0]).toContain('job-id="job_subscribed"');
    expect(texts[0]).toContain('</notification>');
  });

  it('unsubscribed jobId: completion routes through the always-on fallback inject', () => {
    const jobManager = makeJobManager();
    // No subscription for this jobId.

    const state = makeStateStub(jobManager, sessionDir);
    const queueJobNotification = createQueueJobNotification(state, { current: null });

    queueJobNotification(makeJobState('job_unsubscribed'), 'completed');

    const texts = readInjectedNotificationTexts(sessionDir);
    expect(texts).toHaveLength(1);
    // Same wire shape as the subscriber path → fallback preserved.
    expect(texts[0]).toContain('<notification kind="job-completed"');
    expect(texts[0]).toContain('job-id="job_unsubscribed"');
  });

  it('subscribed with on=[failed] only, a successful completion is SILENT (no fallback)', () => {
    // Coverage-discipline contract from the design, exercised end-to-end
    // through createQueueJobNotification: once subscribed, the always-on
    // fallback is suppressed for unmatched kinds.
    const jobManager = makeJobManager();
    jobManager.subscribe({ jobId: 'job_silent', on: ['failed'] });

    const state = makeStateStub(jobManager, sessionDir);
    const queueJobNotification = createQueueJobNotification(state, { current: null });

    queueJobNotification(makeJobState('job_silent'), 'completed');

    const texts = readInjectedNotificationTexts(sessionDir);
    expect(texts).toEqual([]);
  });
});
