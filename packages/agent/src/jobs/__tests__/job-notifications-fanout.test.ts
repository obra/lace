// ABOUTME: Integration test for the createFinalizeJob → fanoutToInject →
// injectNotification path. Spins up a real
// JobManager and the real createQueueJobNotification factory used in
// production by server.ts, then verifies that subscribers cause the
// <notification kind="job-..."> block to be written to events.jsonl via the
// fanout path while unsubscribed jobs still get it via the always-on inject
// fallback. Wire shape stays identical between the two paths.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { JobManager } from '../job-manager';
import { createQueueJobNotification } from '../job-notifications';
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
 * Read context_injected events from the session's transcript via the durable
 * event API. Returns text payloads in order — one entry per injectNotification
 * call.
 */
function readInjectedNotificationTexts(sessionDir: string): string[] {
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

function makeStateStub(jobManager: JobManager, sessionDir: string): AgentServerState {
  return {
    activeTurn: null,
    activeSession: { meta: { sessionId: 'sess_1' }, dir: sessionDir },
    jobManager,
  } as unknown as AgentServerState;
}

describe('createFinalizeJob → fanoutToInject integration', () => {
  let laceDir: string;
  let sessionDir: string;
  let savedLaceDir: string | undefined;

  beforeEach(() => {
    laceDir = mkdtempSync(join(tmpdir(), 'lace-fanout-inject-'));
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
  });

  afterEach(() => {
    if (savedLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = savedLaceDir;
    rmSync(laceDir, { recursive: true, force: true });
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
