# JobManager Consolidation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Consolidate scattered job management code into a unified JobManager class and route all tools through ToolExecutor.

**Architecture:** Create JobManager as a session-scoped service that owns all job state and operations. Pass JobManager through ToolContext so tools can use it directly. Remove special-case tool handling from runner.ts so ALL tools flow through toolExecutor.execute().

**Tech Stack:** TypeScript, Vitest for testing

---

## Background

Currently, job-related code is scattered across multiple locations:

1. **State in AgentServerState:** `jobs`, `jobStreaming`, `jobNotificationQueue`
2. **Operations in jobs/*.ts:** `job-creation.ts`, `job-derivation.ts`, `job-control.ts`, `job-output.ts`, `job-notifications.ts`
3. **Tool execution split:** Runner.ts has inline implementations for delegate/job_output/jobs_list/job_kill, bypassing ToolExecutor
4. **Dead code:** `core/tools/special/` is never called

This refactor:
- Consolidates all job state and operations into `JobManager`
- Makes tool implementations live in their Tool classes
- Ensures ONE code path through `toolExecutor.execute()` for all tools
- Deletes dead code

---

## Task 1: Create JobManager Class with State

**Files:**
- Create: `packages/agent/src/jobs/job-manager.ts` (replace existing file which is just utils)
- Rename: `packages/agent/src/jobs/job-file-utils.ts` (move existing utils here)
- Test: `packages/agent/src/jobs/__tests__/job-manager.test.ts`

**Step 1: Rename existing job-manager.ts to job-file-utils.ts**

The current `job-manager.ts` only has file utilities. Rename it to make room for the real JobManager.

```bash
cd packages/agent
git mv src/jobs/job-manager.ts src/jobs/job-file-utils.ts
```

**Step 2: Update imports for the renamed file**

Find and update all imports of `job-manager.ts`:

```bash
grep -r "from.*job-manager" src/
```

Update each import to use `job-file-utils` instead.

**Step 3: Write the failing test for JobManager construction**

```typescript
// packages/agent/src/jobs/__tests__/job-manager.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JobManager } from '../job-manager';

describe('JobManager', () => {
  describe('construction', () => {
    it('initializes with empty state', () => {
      const deps = {
        getActiveSession: vi.fn().mockReturnValue(null),
        persistEvent: vi.fn(),
        emitUpdate: vi.fn(),
      };

      const manager = new JobManager(deps);

      expect(manager.listJobs()).toEqual([]);
      expect(manager.getStreamingMode()).toBe('full');
    });
  });
});
```

**Step 4: Run test to verify it fails**

```bash
npm test -- --run src/jobs/__tests__/job-manager.test.ts
```

Expected: FAIL with "Cannot find module '../job-manager'"

**Step 5: Write minimal JobManager class**

```typescript
// packages/agent/src/jobs/job-manager.ts
// ABOUTME: Unified job management - state, operations, and notifications
// Consolidates scattered job code into single session-scoped service

import type { JobState, JobStatus, JobType, PendingJobNotification } from '../server-types';

export type JobManagerDeps = {
  getActiveSession: () => { sessionId: string; dir: string } | null;
  persistEvent: (event: { type: string; data: Record<string, unknown> }) => Promise<void>;
  emitUpdate: (update: { type: string; [key: string]: unknown }) => Promise<void>;
};

export class JobManager {
  private jobs = new Map<string, JobState>();
  private streamingMode: 'full' | 'coalesced' | 'none' = 'full';
  private notificationQueue: PendingJobNotification[] = [];
  private deps: JobManagerDeps;

  constructor(deps: JobManagerDeps) {
    this.deps = deps;
  }

  listJobs(): Array<{
    jobId: string;
    type: JobType;
    status: JobStatus;
    description?: string;
  }> {
    return [];
  }

  getStreamingMode(): 'full' | 'coalesced' | 'none' {
    return this.streamingMode;
  }
}
```

**Step 6: Run test to verify it passes**

```bash
npm test -- --run src/jobs/__tests__/job-manager.test.ts
```

Expected: PASS

**Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(agent): create JobManager class skeleton

Renames job-manager.ts to job-file-utils.ts (it only had file utilities)
and creates the real JobManager class that will consolidate all job
state and operations.
EOF
)"
```

---

## Task 2: Move Job State Management to JobManager

**Files:**
- Modify: `packages/agent/src/jobs/job-manager.ts`
- Test: `packages/agent/src/jobs/__tests__/job-manager.test.ts`

**Step 1: Write tests for job state operations**

```typescript
// Add to job-manager.test.ts
describe('job state', () => {
  it('can add and retrieve a job', () => {
    const deps = {
      getActiveSession: vi.fn().mockReturnValue({ sessionId: 'sess_1', dir: '/tmp/sess' }),
      persistEvent: vi.fn(),
      emitUpdate: vi.fn(),
    };
    const manager = new JobManager(deps);

    const job: JobState = {
      jobId: 'job_123',
      type: 'bash',
      status: 'running',
      startedAt: new Date().toISOString(),
      outputPath: '/tmp/job.log',
      finished: false,
      completion: Promise.resolve(),
      resolveCompletion: () => {},
    };

    manager.addJob(job);

    expect(manager.getJob('job_123')).toBe(job);
    expect(manager.getRunningJobs().get('job_123')).toBe(job);
  });

  it('can remove a job', () => {
    const deps = {
      getActiveSession: vi.fn().mockReturnValue({ sessionId: 'sess_1', dir: '/tmp/sess' }),
      persistEvent: vi.fn(),
      emitUpdate: vi.fn(),
    };
    const manager = new JobManager(deps);

    const job: JobState = {
      jobId: 'job_123',
      type: 'bash',
      status: 'running',
      startedAt: new Date().toISOString(),
      outputPath: '/tmp/job.log',
      finished: false,
      completion: Promise.resolve(),
      resolveCompletion: () => {},
    };

    manager.addJob(job);
    manager.removeJob('job_123');

    expect(manager.getJob('job_123')).toBeUndefined();
  });

  it('streaming mode can be changed', () => {
    const deps = {
      getActiveSession: vi.fn().mockReturnValue(null),
      persistEvent: vi.fn(),
      emitUpdate: vi.fn(),
    };
    const manager = new JobManager(deps);

    manager.setStreamingMode('coalesced');
    expect(manager.getStreamingMode()).toBe('coalesced');
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- --run src/jobs/__tests__/job-manager.test.ts
```

Expected: FAIL - methods don't exist

**Step 3: Implement job state methods**

```typescript
// Add to JobManager class in job-manager.ts

addJob(job: JobState): void {
  this.jobs.set(job.jobId, job);
}

getJob(jobId: string): JobState | undefined {
  return this.jobs.get(jobId);
}

removeJob(jobId: string): void {
  this.jobs.delete(jobId);
}

getRunningJobs(): Map<string, JobState> {
  return this.jobs;
}

setStreamingMode(mode: 'full' | 'coalesced' | 'none'): void {
  this.streamingMode = mode;
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test -- --run src/jobs/__tests__/job-manager.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add -A
git commit -m "feat(agent): add job state management to JobManager"
```

---

## Task 3: Move listJobs (formerly deriveJobs) to JobManager

**Files:**
- Modify: `packages/agent/src/jobs/job-manager.ts`
- Reference: `packages/agent/src/jobs/job-derivation.ts` (will be deleted later)
- Test: `packages/agent/src/jobs/__tests__/job-manager.test.ts`

**Step 1: Write test for listJobs**

```typescript
// Add to job-manager.test.ts
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('listJobs', () => {
  it('returns empty array when no session', () => {
    const deps = {
      getActiveSession: vi.fn().mockReturnValue(null),
      persistEvent: vi.fn(),
      emitUpdate: vi.fn(),
    };
    const manager = new JobManager(deps);

    expect(manager.listJobs()).toEqual([]);
  });

  it('reconstructs jobs from events.jsonl', () => {
    const testDir = join(tmpdir(), `job-manager-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    // Write test events
    const events = [
      { type: 'job_started', timestamp: '2025-01-15T10:00:00Z', data: { jobId: 'job_1', jobType: 'bash', description: 'test job' } },
      { type: 'job_finished', timestamp: '2025-01-15T10:01:00Z', data: { jobId: 'job_1', outcome: 'completed', exitCode: 0 } },
    ];
    writeFileSync(join(testDir, 'events.jsonl'), events.map(e => JSON.stringify(e)).join('\n'));

    const deps = {
      getActiveSession: vi.fn().mockReturnValue({ sessionId: 'sess_1', dir: testDir }),
      persistEvent: vi.fn(),
      emitUpdate: vi.fn(),
    };
    const manager = new JobManager(deps);

    const jobs = manager.listJobs();

    expect(jobs).toHaveLength(1);
    expect(jobs[0].jobId).toBe('job_1');
    expect(jobs[0].status).toBe('completed');
    expect(jobs[0].type).toBe('bash');

    // Cleanup
    rmSync(testDir, { recursive: true });
  });

  it('includes subagentSessionId from job_session_assigned events', () => {
    const testDir = join(tmpdir(), `job-manager-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    const events = [
      { type: 'job_started', timestamp: '2025-01-15T10:00:00Z', data: { jobId: 'job_1', jobType: 'delegate', description: 'subagent' } },
      { type: 'job_session_assigned', timestamp: '2025-01-15T10:00:01Z', data: { jobId: 'job_1', subagentSessionId: 'sess_sub_123' } },
      { type: 'job_finished', timestamp: '2025-01-15T10:01:00Z', data: { jobId: 'job_1', outcome: 'completed' } },
    ];
    writeFileSync(join(testDir, 'events.jsonl'), events.map(e => JSON.stringify(e)).join('\n'));

    const deps = {
      getActiveSession: vi.fn().mockReturnValue({ sessionId: 'sess_1', dir: testDir }),
      persistEvent: vi.fn(),
      emitUpdate: vi.fn(),
    };
    const manager = new JobManager(deps);

    const jobs = manager.listJobs();

    expect(jobs[0].subagentSessionId).toBe('sess_sub_123');

    rmSync(testDir, { recursive: true });
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- --run src/jobs/__tests__/job-manager.test.ts
```

Expected: FAIL - listJobs returns empty array

**Step 3: Implement listJobs**

Copy the logic from `job-derivation.ts` into `JobManager.listJobs()`, adapting it to use instance state:

```typescript
// Add to job-manager.ts
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Add type for derived job record
export type JobRecord = {
  jobId: string;
  parentJobId?: string;
  type: JobType;
  status: JobStatus;
  description?: string;
  command?: string;
  startTime: string;
  exitCode?: number;
  subagentSessionId?: string;
};

// Add to JobManager class - cache fields
private listJobsCache: {
  sessionId: string;
  fileSize: number;
  fileMtime: number;
  result: JobRecord[];
} | null = null;

listJobs(): JobRecord[] {
  const activeSession = this.deps.getActiveSession();
  if (!activeSession) return [];

  const { sessionId, dir: sessionDir } = activeSession;
  const eventsPath = join(sessionDir, 'events.jsonl');

  // Check file stats for cache validation
  let fileSize = 0;
  let fileMtime = 0;
  try {
    const stats = statSync(eventsPath);
    fileSize = stats.size;
    fileMtime = stats.mtimeMs;
  } catch {
    return [];
  }

  // Return cached result if valid
  if (
    this.listJobsCache &&
    this.listJobsCache.sessionId === sessionId &&
    this.listJobsCache.fileSize === fileSize &&
    this.listJobsCache.fileMtime === fileMtime
  ) {
    return this.applyRunningStatus(this.listJobsCache.result);
  }

  // Parse events file
  let raw = '';
  try {
    raw = readFileSync(eventsPath, 'utf8');
  } catch {
    return [];
  }

  const byId = new Map<string, JobRecord>();
  const lines = raw.split('\n');

  for (const line of lines) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as { type?: string; timestamp?: string; data?: Record<string, unknown> };
      if (!['job_started', 'job_finished', 'job_session_assigned'].includes(parsed.type ?? '')) {
        continue;
      }

      const timestamp = typeof parsed.timestamp === 'string' ? parsed.timestamp : undefined;
      const data = parsed.data ?? {};
      const jobId = typeof data.jobId === 'string' ? data.jobId : undefined;
      if (!jobId) continue;

      if (parsed.type === 'job_started') {
        const jobType = data.jobType === 'delegate' ? 'delegate' : 'bash';
        byId.set(jobId, {
          jobId,
          parentJobId: typeof data.parentJobId === 'string' ? data.parentJobId : undefined,
          type: jobType,
          status: 'running',
          description: typeof data.description === 'string' ? data.description : undefined,
          command: typeof data.command === 'string' ? data.command : undefined,
          startTime: timestamp ?? new Date().toISOString(),
        });
      } else if (parsed.type === 'job_session_assigned') {
        const existing = byId.get(jobId);
        const subagentSessionId = typeof data.subagentSessionId === 'string' ? data.subagentSessionId : undefined;
        if (existing && subagentSessionId) {
          existing.subagentSessionId = subagentSessionId;
        }
      } else {
        // job_finished
        const existing = byId.get(jobId);
        const exitCode = typeof data.exitCode === 'number' ? data.exitCode : undefined;
        const outcome = ['completed', 'failed', 'cancelled'].includes(data.outcome as string)
          ? (data.outcome as JobStatus)
          : undefined;

        if (existing) {
          existing.status = outcome ?? existing.status;
          existing.exitCode = exitCode;
        } else {
          byId.set(jobId, {
            jobId,
            type: 'bash',
            status: outcome ?? 'failed',
            startTime: timestamp ?? new Date().toISOString(),
            exitCode,
          });
        }
      }
    } catch {
      // Ignore malformed lines
    }
  }

  const result = Array.from(byId.values());
  this.listJobsCache = { sessionId, fileSize, fileMtime, result };

  return this.applyRunningStatus(result);
}

private applyRunningStatus(jobs: JobRecord[]): JobRecord[] {
  return jobs.map((job) => {
    if (job.status === 'running' && !this.jobs.has(job.jobId)) {
      return { ...job, status: 'failed' as JobStatus };
    }
    return job;
  });
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test -- --run src/jobs/__tests__/job-manager.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add -A
git commit -m "feat(agent): implement listJobs in JobManager (was deriveJobs)"
```

---

## Task 4: Move createJob to JobManager

**Files:**
- Modify: `packages/agent/src/jobs/job-manager.ts`
- Reference: `packages/agent/src/jobs/job-creation.ts` (will be deleted later)
- Test: `packages/agent/src/jobs/__tests__/job-manager.test.ts`

**Step 1: Extend JobManagerDeps for job creation**

```typescript
// Update JobManagerDeps in job-manager.ts
export type JobManagerDeps = {
  getActiveSession: () => { sessionId: string; dir: string } | null;
  persistEvent: (event: { type: string; data: Record<string, unknown> }) => Promise<void>;
  emitUpdate: (update: { type: string; [key: string]: unknown }) => Promise<void>;
  runShellProcess: (job: JobState) => void;
  runSubagentProcess: (job: JobState) => void;
};
```

**Step 2: Write test for createJob**

```typescript
// Add to job-manager.test.ts
describe('createJob', () => {
  it('creates a shell job', async () => {
    const testDir = join(tmpdir(), `job-manager-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, 'jobs'), { recursive: true });
    writeFileSync(join(testDir, 'events.jsonl'), '');

    const persistEvent = vi.fn();
    const emitUpdate = vi.fn();
    const runShellProcess = vi.fn();

    const deps = {
      getActiveSession: vi.fn().mockReturnValue({ sessionId: 'sess_1', dir: testDir }),
      persistEvent,
      emitUpdate,
      runShellProcess,
      runSubagentProcess: vi.fn(),
    };
    const manager = new JobManager(deps);

    const { jobId, job } = await manager.createJob('shell', {
      command: 'echo hello',
      description: 'test shell job',
    });

    expect(jobId).toMatch(/^job_/);
    expect(job.type).toBe('bash');
    expect(job.status).toBe('running');
    expect(job.command).toBe('echo hello');
    expect(manager.getJob(jobId)).toBe(job);
    expect(persistEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'job_started',
      data: expect.objectContaining({ jobId, jobType: 'bash' }),
    }));
    expect(runShellProcess).toHaveBeenCalledWith(job);

    rmSync(testDir, { recursive: true });
  });

  it('creates a delegate job', async () => {
    const testDir = join(tmpdir(), `job-manager-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, 'jobs'), { recursive: true });
    writeFileSync(join(testDir, 'events.jsonl'), '');

    const persistEvent = vi.fn();
    const runSubagentProcess = vi.fn();

    const deps = {
      getActiveSession: vi.fn().mockReturnValue({ sessionId: 'sess_1', dir: testDir }),
      persistEvent,
      emitUpdate: vi.fn(),
      runShellProcess: vi.fn(),
      runSubagentProcess,
    };
    const manager = new JobManager(deps);

    const { jobId, job } = await manager.createJob('delegate', {
      prompt: 'do something',
      description: 'test delegate',
    });

    expect(jobId).toMatch(/^job_/);
    expect(job.type).toBe('delegate');
    expect(job.command).toBe('do something');
    expect(runSubagentProcess).toHaveBeenCalledWith(job);

    rmSync(testDir, { recursive: true });
  });

  it('throws when no active session', async () => {
    const deps = {
      getActiveSession: vi.fn().mockReturnValue(null),
      persistEvent: vi.fn(),
      emitUpdate: vi.fn(),
      runShellProcess: vi.fn(),
      runSubagentProcess: vi.fn(),
    };
    const manager = new JobManager(deps);

    await expect(manager.createJob('shell', { command: 'test' }))
      .rejects.toThrow('No active session');
  });
});
```

**Step 3: Run tests to verify they fail**

```bash
npm test -- --run src/jobs/__tests__/job-manager.test.ts
```

Expected: FAIL - createJob doesn't exist

**Step 4: Implement createJob**

```typescript
// Add imports at top of job-manager.ts
import { randomUUID } from 'node:crypto';
import { ensureJobLogDir, getJobOutputPath } from './job-file-utils';
import { MAX_CONCURRENT_JOBS } from '../server-types';

// Add types
export type CreateJobOptions = {
  command?: string;      // for shell
  prompt?: string;       // for delegate
  description?: string;
  parentJobId?: string;
  turnContext?: { turnId: string; turnSeq: number };
  resumeSessionId?: string;  // for delegate resume
  connectionId?: string;
  modelId?: string;
};

export class JobCreationError extends Error {
  constructor(
    message: string,
    public code: number,
    public category: string
  ) {
    super(message);
    this.name = 'JobCreationError';
  }
}

// Add to JobManager class
async createJob(
  type: 'shell' | 'delegate',
  options: CreateJobOptions
): Promise<{ jobId: string; job: JobState }> {
  const activeSession = this.deps.getActiveSession();
  if (!activeSession) {
    throw new JobCreationError('No active session', -32001, 'session');
  }

  const runningCount = [...this.jobs.values()].filter((j) => j.status === 'running').length;
  if (runningCount >= MAX_CONCURRENT_JOBS) {
    throw new JobCreationError(
      `Maximum concurrent jobs (${MAX_CONCURRENT_JOBS}) exceeded`,
      -32003,
      'session'
    );
  }

  const jobId = `job_${randomUUID()}`;
  const startedAt = new Date().toISOString();
  const outputPath = getJobOutputPath(activeSession.dir, jobId);

  let resolveCompletion!: () => void;
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });

  const jobType: JobType = type === 'shell' ? 'bash' : 'delegate';
  const command = type === 'shell' ? options.command : options.prompt;
  const description = options.description ?? (type === 'delegate' ? 'Subagent' : undefined);

  const job: JobState = {
    jobId,
    parentJobId: options.parentJobId,
    type: jobType,
    status: 'running',
    description,
    command,
    startedAt,
    originTurnId: options.turnContext?.turnId,
    originTurnSeq: options.turnContext?.turnSeq,
    outputPath,
    finished: false,
    completion,
    resolveCompletion,
    ...(type === 'delegate' && options.prompt
      ? { subagentContent: [{ type: 'text' as const, text: options.prompt }] }
      : {}),
    ...(options.resumeSessionId ? { subagentSessionId: options.resumeSessionId } : {}),
    ...(options.connectionId ? { connectionId: options.connectionId } : {}),
    ...(options.modelId ? { modelId: options.modelId } : {}),
  };

  this.jobs.set(jobId, job);

  await this.deps.persistEvent({
    type: 'job_started',
    data: {
      jobId,
      parentJobId: options.parentJobId,
      jobType,
      description,
      command,
      ...(options.turnContext ?? {}),
    },
  });

  await this.deps.emitUpdate({
    type: 'job_started',
    jobId,
    parentJobId: options.parentJobId,
    jobType,
    description,
  });

  // Start the process
  if (type === 'shell') {
    this.deps.runShellProcess(job);
  } else {
    this.deps.runSubagentProcess(job);
  }

  return { jobId, job };
}
```

**Step 5: Run tests to verify they pass**

```bash
npm test -- --run src/jobs/__tests__/job-manager.test.ts
```

Expected: PASS

**Step 6: Commit**

```bash
git add -A
git commit -m "feat(agent): implement createJob in JobManager (unifies shell and delegate)"
```

---

## Task 5: Move finalizeJob and cancelJob to JobManager

**Files:**
- Modify: `packages/agent/src/jobs/job-manager.ts`
- Reference: `packages/agent/src/jobs/job-control.ts`
- Test: `packages/agent/src/jobs/__tests__/job-manager.test.ts`

**Step 1: Write tests for finalizeJob and cancelJob**

```typescript
// Add to job-manager.test.ts
describe('finalizeJob', () => {
  it('persists job_finished event and removes from running jobs', async () => {
    const persistEvent = vi.fn();
    const emitUpdate = vi.fn();

    const deps = {
      getActiveSession: vi.fn().mockReturnValue({ sessionId: 'sess_1', dir: '/tmp' }),
      persistEvent,
      emitUpdate,
      runShellProcess: vi.fn(),
      runSubagentProcess: vi.fn(),
    };
    const manager = new JobManager(deps);

    let resolver: () => void;
    const job: JobState = {
      jobId: 'job_123',
      type: 'bash',
      status: 'completed',
      startedAt: new Date().toISOString(),
      outputPath: '/tmp/job.log',
      finished: false,
      completion: new Promise((r) => { resolver = r; }),
      resolveCompletion: () => resolver(),
      exitCode: 0,
    };

    manager.addJob(job);
    await manager.finalizeJob(job);

    expect(persistEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'job_finished',
      data: expect.objectContaining({ jobId: 'job_123', outcome: 'completed', exitCode: 0 }),
    }));
    expect(manager.getJob('job_123')).toBeUndefined();
  });
});

describe('cancelJob', () => {
  it('sets job status to cancelled and finalizes', async () => {
    const persistEvent = vi.fn();
    const emitUpdate = vi.fn();

    const deps = {
      getActiveSession: vi.fn().mockReturnValue({ sessionId: 'sess_1', dir: '/tmp' }),
      persistEvent,
      emitUpdate,
      runShellProcess: vi.fn(),
      runSubagentProcess: vi.fn(),
    };
    const manager = new JobManager(deps);

    let resolver: () => void;
    const job: JobState = {
      jobId: 'job_123',
      type: 'bash',
      status: 'running',
      startedAt: new Date().toISOString(),
      outputPath: '/tmp/job.log',
      finished: false,
      completion: new Promise((r) => { resolver = r; }),
      resolveCompletion: () => resolver(),
    };

    manager.addJob(job);
    await manager.cancelJob('job_123');

    expect(job.status).toBe('cancelled');
    expect(persistEvent).toHaveBeenCalled();
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- --run src/jobs/__tests__/job-manager.test.ts
```

**Step 3: Implement finalizeJob and cancelJob**

```typescript
// Add to JobManager class

async finalizeJob(job: JobState): Promise<void> {
  if (job.finished) return;
  job.finished = true;

  await this.deps.persistEvent({
    type: 'job_finished',
    data: {
      jobId: job.jobId,
      outcome: job.status,
      exitCode: job.exitCode,
    },
  });

  await this.deps.emitUpdate({
    type: 'job_finished',
    jobId: job.jobId,
    outcome: job.status,
    exitCode: job.exitCode,
  });

  job.resolveCompletion?.();
  this.jobs.delete(job.jobId);
}

async cancelJob(jobId: string): Promise<void> {
  const job = this.jobs.get(jobId);
  if (!job) return;

  job.status = 'cancelled';
  await this.finalizeJob(job);
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test -- --run src/jobs/__tests__/job-manager.test.ts
```

**Step 5: Commit**

```bash
git add -A
git commit -m "feat(agent): implement finalizeJob and cancelJob in JobManager"
```

---

## Task 6: Move getJobOutput to JobManager

**Files:**
- Modify: `packages/agent/src/jobs/job-manager.ts`
- Reference: `packages/agent/src/jobs/job-output.ts`
- Test: `packages/agent/src/jobs/__tests__/job-manager.test.ts`

**Step 1: Write test for getJobOutput**

```typescript
// Add to job-manager.test.ts
describe('getJobOutput', () => {
  it('reads output from job file', () => {
    const testDir = join(tmpdir(), `job-manager-test-${Date.now()}`);
    const jobsDir = join(testDir, 'jobs');
    mkdirSync(jobsDir, { recursive: true });
    writeFileSync(join(jobsDir, 'job_123.log'), 'hello world\nline 2');

    const deps = {
      getActiveSession: vi.fn().mockReturnValue({ sessionId: 'sess_1', dir: testDir }),
      persistEvent: vi.fn(),
      emitUpdate: vi.fn(),
      runShellProcess: vi.fn(),
      runSubagentProcess: vi.fn(),
    };
    const manager = new JobManager(deps);

    const output = manager.getJobOutput('job_123');

    expect(output).toBe('hello world\nline 2');

    rmSync(testDir, { recursive: true });
  });

  it('returns empty string when no session', () => {
    const deps = {
      getActiveSession: vi.fn().mockReturnValue(null),
      persistEvent: vi.fn(),
      emitUpdate: vi.fn(),
      runShellProcess: vi.fn(),
      runSubagentProcess: vi.fn(),
    };
    const manager = new JobManager(deps);

    expect(manager.getJobOutput('job_123')).toBe('');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -- --run src/jobs/__tests__/job-manager.test.ts
```

**Step 3: Implement getJobOutput**

```typescript
// Add to JobManager class

getJobOutput(jobId: string): string {
  const activeSession = this.deps.getActiveSession();
  if (!activeSession) return '';

  const outputPath = getJobOutputPath(activeSession.dir, jobId);
  try {
    return readFileSync(outputPath, 'utf8');
  } catch {
    return '';
  }
}
```

**Step 4: Run test to verify it passes**

```bash
npm test -- --run src/jobs/__tests__/job-manager.test.ts
```

**Step 5: Commit**

```bash
git add -A
git commit -m "feat(agent): implement getJobOutput in JobManager"
```

---

## Task 7: Move Notification Queue to JobManager

**Files:**
- Modify: `packages/agent/src/jobs/job-manager.ts`
- Reference: `packages/agent/src/jobs/job-notifications.ts`
- Test: `packages/agent/src/jobs/__tests__/job-manager.test.ts`

**Step 1: Write tests for notification queue**

```typescript
// Add to job-manager.test.ts
describe('notification queue', () => {
  it('can queue and flush notifications', () => {
    const deps = {
      getActiveSession: vi.fn().mockReturnValue(null),
      persistEvent: vi.fn(),
      emitUpdate: vi.fn(),
      runShellProcess: vi.fn(),
      runSubagentProcess: vi.fn(),
    };
    const manager = new JobManager(deps);

    manager.queueNotification({ jobId: 'job_1', type: 'progress' });
    manager.queueNotification({ jobId: 'job_2', type: 'completed' });

    const flushed = manager.flushNotifications();

    expect(flushed).toHaveLength(2);
    expect(flushed[0].jobId).toBe('job_1');
    expect(manager.flushNotifications()).toHaveLength(0); // queue is empty after flush
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -- --run src/jobs/__tests__/job-manager.test.ts
```

**Step 3: Implement notification queue methods**

```typescript
// Add to JobManager class

queueNotification(notification: PendingJobNotification): void {
  this.notificationQueue.push(notification);
}

flushNotifications(): PendingJobNotification[] {
  const notifications = [...this.notificationQueue];
  this.notificationQueue = [];
  return notifications;
}

getNotificationQueue(): PendingJobNotification[] {
  return this.notificationQueue;
}
```

**Step 4: Run test to verify it passes**

```bash
npm test -- --run src/jobs/__tests__/job-manager.test.ts
```

**Step 5: Commit**

```bash
git add -A
git commit -m "feat(agent): implement notification queue in JobManager"
```

---

## Task 8: Add JobManager to ToolContext

**Files:**
- Modify: `packages/agent/src/tools/types.ts`
- Test: `packages/agent/src/tools/types.test.ts`

**Step 1: Add jobManager to ToolContext interface**

```typescript
// In packages/agent/src/tools/types.ts, add import at top:
import type { JobManager } from '@lace/agent/jobs/job-manager';

// Add to ToolContext interface:
export interface ToolContext {
  // ... existing fields ...

  // Job management (provided by runner for job-related tools)
  jobManager?: JobManager;

  // Turn context for job creation
  turnId?: string;
  turnSeq?: number;
}
```

**Step 2: Commit**

```bash
git add -A
git commit -m "feat(agent): add jobManager to ToolContext interface"
```

---

## Task 9: Wire JobManager into AgentServerState

**Files:**
- Modify: `packages/agent/src/server-types.ts`
- Modify: `packages/agent/src/server.ts`

**Step 1: Update AgentServerState to use JobManager**

```typescript
// In server-types.ts, add import:
import type { JobManager } from './jobs/job-manager';

// Update AgentServerState - replace the three job fields with:
export type AgentServerState = {
  initialized: boolean;
  activeSession: LoadedSession | null;
  config: { executionMode: ExecutionMode; approvalMode: ApprovalMode };
  activeTurn: { ... } | null;
  providerCatalog: ProviderCatalogManager;
  providerCatalogLoaded: boolean;
  providerInstances: ProviderInstanceManager;
  mcpServerManager: MCPServerManager;
  jobManager: JobManager;  // replaces: jobs, jobStreaming, jobNotificationQueue
  pendingPermissionRequests: Map<...>;
  sessionMutex: Promise<void>;
};
```

**Step 2: Update server.ts to create JobManager**

```typescript
// In server.ts createAgentServerState():
import { JobManager } from './jobs/job-manager';

export function createAgentServerState(): AgentServerState {
  // Create JobManager with deps that reference state (circular but necessary)
  // We'll set the deps after state is created
  const state: AgentServerState = {
    initialized: false,
    activeSession: null,
    config: { executionMode: 'execute', approvalMode: 'ask' },
    activeTurn: null,
    providerCatalog: new ProviderCatalogManager(),
    providerCatalogLoaded: false,
    providerInstances: new ProviderInstanceManager(),
    mcpServerManager: new MCPServerManager(),
    jobManager: null as unknown as JobManager, // Placeholder
    pendingPermissionRequests: new Map(),
    sessionMutex: Promise.resolve(),
  };

  return state;
}

// In registerAgentRpcMethods(), create the actual JobManager:
const jobManager = new JobManager({
  getActiveSession: () => state.activeSession
    ? { sessionId: state.activeSession.meta.sessionId, dir: state.activeSession.dir }
    : null,
  persistEvent: async (event) => {
    if (!state.activeSession) return;
    // Use existing event persistence
    appendDurableEvent(state.activeSession.dir, ...);
  },
  emitUpdate: async (update) => {
    // Use existing emitSessionUpdate
    emitSessionUpdate(update);
  },
  runShellProcess: runShellJobProcess,
  runSubagentProcess: runSubagentJobProcess,
});
state.jobManager = jobManager;
```

**Step 3: Update all references from state.jobs to state.jobManager**

Search for `state.jobs` and update:
- `state.jobs.get(...)` → `state.jobManager.getJob(...)`
- `state.jobs.set(...)` → `state.jobManager.addJob(...)`
- `state.jobs.delete(...)` → `state.jobManager.removeJob(...)`
- `state.jobStreaming` → `state.jobManager.getStreamingMode()`
- `state.jobNotificationQueue` → `state.jobManager.getNotificationQueue()`

**Step 4: Run tests**

```bash
npm test -- --run
```

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor(agent): wire JobManager into AgentServerState"
```

---

## Task 10: Implement DelegateTool.executeValidated()

**Files:**
- Modify: `packages/agent/src/tools/implementations/delegate.ts`
- Test: `packages/agent/src/tools/implementations/__tests__/delegate.test.ts`

**Step 1: Write test for DelegateTool execution**

```typescript
// packages/agent/src/tools/implementations/__tests__/delegate.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DelegateTool } from '../delegate';
import { JobManager } from '@lace/agent/jobs/job-manager';

describe('DelegateTool', () => {
  it('returns error when jobManager not in context', async () => {
    const tool = new DelegateTool();
    const result = await tool.execute(
      { prompt: 'test' },
      { signal: new AbortController().signal }
    );

    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('jobManager');
  });

  it('creates delegate job and waits for completion (sync mode)', async () => {
    const tool = new DelegateTool();

    let resolveJob: () => void;
    const completion = new Promise<void>((r) => { resolveJob = r; });

    const mockJob = {
      jobId: 'job_123',
      type: 'delegate' as const,
      status: 'completed' as const,
      completion,
      resolveCompletion: () => resolveJob(),
    };

    const jobManager = {
      createJob: vi.fn().mockResolvedValue({ jobId: 'job_123', job: mockJob }),
      listJobs: vi.fn().mockReturnValue([]),
      getJobOutput: vi.fn().mockReturnValue('subagent output here'),
      finalizeJob: vi.fn(),
    } as unknown as JobManager;

    // Resolve job completion immediately
    setTimeout(() => resolveJob(), 10);

    const result = await tool.execute(
      { prompt: 'do something' },
      { signal: new AbortController().signal, jobManager }
    );

    expect(jobManager.createJob).toHaveBeenCalledWith('delegate', expect.objectContaining({
      prompt: 'do something',
    }));
    expect(result.status).toBe('completed');
    expect(result.content[0].text).toContain('job_123');
  });

  it('returns immediately in background mode', async () => {
    const tool = new DelegateTool();

    const mockJob = {
      jobId: 'job_456',
      type: 'delegate' as const,
      status: 'running' as const,
      completion: new Promise<void>(() => {}), // Never resolves
    };

    const jobManager = {
      createJob: vi.fn().mockResolvedValue({ jobId: 'job_456', job: mockJob }),
      listJobs: vi.fn().mockReturnValue([]),
    } as unknown as JobManager;

    const result = await tool.execute(
      { prompt: 'do something', background: true },
      { signal: new AbortController().signal, jobManager }
    );

    expect(result.status).toBe('completed');
    expect(result.content[0].text).toContain('job_456');
    expect(result.content[0].text).toContain('started');
  });

  it('resumes previous job session', async () => {
    const tool = new DelegateTool();

    let resolveJob: () => void;
    const completion = new Promise<void>((r) => { resolveJob = r; });
    const mockJob = {
      jobId: 'job_789',
      completion,
      resolveCompletion: () => resolveJob(),
    };

    const jobManager = {
      createJob: vi.fn().mockResolvedValue({ jobId: 'job_789', job: mockJob }),
      listJobs: vi.fn().mockReturnValue([
        { jobId: 'job_prev', subagentSessionId: 'sess_sub_abc' },
      ]),
      getJobOutput: vi.fn().mockReturnValue('resumed output'),
      finalizeJob: vi.fn(),
    } as unknown as JobManager;

    setTimeout(() => resolveJob(), 10);

    const result = await tool.execute(
      { prompt: 'continue', resume: 'job_prev' },
      { signal: new AbortController().signal, jobManager }
    );

    expect(jobManager.createJob).toHaveBeenCalledWith('delegate', expect.objectContaining({
      prompt: 'continue',
      resumeSessionId: 'sess_sub_abc',
    }));
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -- --run src/tools/implementations/__tests__/delegate.test.ts
```

**Step 3: Implement DelegateTool.executeValidated()**

```typescript
// packages/agent/src/tools/implementations/delegate.ts
// ABOUTME: Delegate tool - spawns subagent jobs
// Uses JobManager from ToolContext for all job operations

import { z } from 'zod';
import { Tool } from '../tool';
import { NonEmptyString } from '../schemas/common';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';
import { readJobOutputTail } from '@lace/agent/jobs/job-output';
import { getJobOutputPath } from '@lace/agent/jobs/job-file-utils';

const delegateSchema = z
  .object({
    prompt: NonEmptyString,
    description: z.string().optional(),
    background: z.boolean().default(false),
    resume: z.string().optional(),
    progressIntervalMs: z.number().int().min(5000).max(600000).optional(),
    connectionId: z.string().optional(),
    modelId: z.string().optional(),
  })
  .strict();

export class DelegateTool extends Tool {
  name = 'delegate';
  description = `Spawn a subagent to handle a task autonomously. ALL delegate jobs are resumable - the subagent session persists after completion.

Parameters:
- prompt: The task or message for the subagent (required)
- description: Label shown in job listings (optional)
- background: Set to true to return immediately with jobId (default: false)
- resume: JobId of a previous delegate job to continue its session
- connectionId: Provider connection to use (optional)
- modelId: Model to use (optional)

**Sync mode (default):** Blocks until subagent completes.
**Background mode:** Returns { jobId, status: "started" } immediately.
**Resuming:** Use resume="<jobId>" to continue a previous subagent's session.`;

  schema = delegateSchema;
  annotations: ToolAnnotations = {
    title: 'Delegate',
    safeInternal: true,
  };

  protected async executeValidated(
    args: z.infer<typeof delegateSchema>,
    context: ToolContext
  ): Promise<ToolResult> {
    const { jobManager } = context;

    if (!jobManager) {
      return {
        status: 'failed',
        content: [{ type: 'text', text: 'delegate requires jobManager in context' }],
      };
    }

    const { prompt, description, background, resume, connectionId, modelId } = args;

    // Handle resume - look up previous job's session
    let resumeSessionId: string | undefined;
    if (resume) {
      const jobs = jobManager.listJobs();
      const previousJob = jobs.find((j) => j.jobId === resume);
      if (!previousJob?.subagentSessionId) {
        const jobIds = jobs.map((j) => j.jobId).join(', ');
        const withSession = jobs
          .filter((j) => j.subagentSessionId)
          .map((j) => `${j.jobId}=${j.subagentSessionId}`)
          .join(', ');
        return {
          status: 'failed',
          content: [{
            type: 'text',
            text: `Cannot resume job ${resume}: no subagentSessionId found.\n` +
              `Available jobs: [${jobIds}]\n` +
              `Jobs with sessionId: [${withSession || 'none'}]`,
          }],
        };
      }
      resumeSessionId = previousJob.subagentSessionId;
    }

    // Create the job
    const { jobId, job } = await jobManager.createJob('delegate', {
      prompt,
      description,
      resumeSessionId,
      connectionId,
      modelId,
      turnContext: context.turnId && context.turnSeq !== undefined
        ? { turnId: context.turnId, turnSeq: context.turnSeq }
        : undefined,
    });

    // Background mode - return immediately
    if (background) {
      return {
        status: 'completed',
        content: [{ type: 'text', text: JSON.stringify({ jobId, status: 'started' }) }],
      };
    }

    // Sync mode - wait for completion
    const abortPromise = new Promise<never>((_, reject) => {
      context.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
    });

    try {
      await Promise.race([job.completion, abortPromise]);
    } catch {
      job.status = 'cancelled';
      await jobManager.finalizeJob(job);
    }

    // Read output
    const activeSession = (jobManager as any).deps?.getActiveSession?.();
    const sessionDir = activeSession?.dir ?? '';
    const { output, truncated } = sessionDir
      ? readJobOutputTail(getJobOutputPath(sessionDir, jobId))
      : { output: '', truncated: false };

    const status = job.status ?? 'failed';
    return {
      status: status === 'completed' ? 'completed' : status === 'cancelled' ? 'aborted' : 'failed',
      content: [{
        type: 'text',
        text: `delegate jobId=${jobId}\n\n` +
          (output.trim().length > 0 ? output.trim() : '(no output)') +
          (truncated ? '\n\n(truncated)' : ''),
      }],
    };
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test -- --run src/tools/implementations/__tests__/delegate.test.ts
```

**Step 5: Commit**

```bash
git add -A
git commit -m "feat(agent): implement DelegateTool.executeValidated() using JobManager"
```

---

## Task 11: Implement Job Tool executeValidated() Methods

**Files:**
- Modify: `packages/agent/src/tools/implementations/job_output.ts`
- Modify: `packages/agent/src/tools/implementations/jobs_list.ts`
- Modify: `packages/agent/src/tools/implementations/job_kill.ts`
- Test: `packages/agent/src/tools/implementations/__tests__/job-tools.test.ts`

Follow the same pattern as Task 10 - implement `executeValidated()` for each tool using `context.jobManager`. These are simpler than delegate:

- **JobOutputTool**: Call `jobManager.getJob()` to check status, `jobManager.getJobOutput()` to read output
- **JobsListTool**: Call `jobManager.listJobs()` with filtering
- **JobKillTool**: Call `jobManager.cancelJob()`

**Step 1: Write tests**

```typescript
// packages/agent/src/tools/implementations/__tests__/job-tools.test.ts
import { describe, it, expect, vi } from 'vitest';
import { JobOutputTool } from '../job_output';
import { JobsListTool } from '../jobs_list';
import { JobKillTool } from '../job_kill';

describe('JobOutputTool', () => {
  it('returns job output', async () => {
    const tool = new JobOutputTool();
    const jobManager = {
      getJob: vi.fn().mockReturnValue({ status: 'completed', exitCode: 0 }),
      getJobOutput: vi.fn().mockReturnValue('hello world'),
    };

    const result = await tool.execute(
      { jobId: 'job_123' },
      { signal: new AbortController().signal, jobManager: jobManager as any }
    );

    expect(result.status).toBe('completed');
    expect(result.content[0].text).toContain('hello world');
  });
});

describe('JobsListTool', () => {
  it('returns job list', async () => {
    const tool = new JobsListTool();
    const jobManager = {
      listJobs: vi.fn().mockReturnValue([
        { jobId: 'job_1', type: 'bash', status: 'completed' },
        { jobId: 'job_2', type: 'delegate', status: 'running' },
      ]),
    };

    const result = await tool.execute(
      {},
      { signal: new AbortController().signal, jobManager: jobManager as any }
    );

    expect(result.status).toBe('completed');
    expect(result.content[0].text).toContain('job_1');
    expect(result.content[0].text).toContain('job_2');
  });
});

describe('JobKillTool', () => {
  it('cancels job', async () => {
    const tool = new JobKillTool();
    const jobManager = {
      cancelJob: vi.fn(),
      getJob: vi.fn().mockReturnValue({ status: 'cancelled' }),
    };

    const result = await tool.execute(
      { jobId: 'job_123' },
      { signal: new AbortController().signal, jobManager: jobManager as any }
    );

    expect(jobManager.cancelJob).toHaveBeenCalledWith('job_123');
    expect(result.status).toBe('completed');
  });
});
```

**Step 2: Implement each tool** (similar pattern to DelegateTool)

**Step 3: Run tests**

```bash
npm test -- --run src/tools/implementations/__tests__/job-tools.test.ts
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat(agent): implement job tool executeValidated() methods"
```

---

## Task 12: Update Runner to Pass JobManager via Context

**Files:**
- Modify: `packages/agent/src/core/conversation/runner.ts`

**Step 1: Update executeToolByName to pass jobManager in context**

In `runner.ts`, modify the `toolExecutor.execute()` call to include jobManager:

```typescript
// In executeToolByName, update the default case:
return await toolExecutor.execute(
  { id: toolCallId, name: toolName, arguments: finalInput },
  {
    signal: abortController.signal,
    workingDirectory: cwd,
    toolTempRoot: join(this.config.sessionDir, 'tool-temp'),
    processEnv: envOverlay,
    hasFileBeenRead: (p: string) => filesRead.has(isAbsolutePath(p) ? p : resolvePath(cwd, p)),
    jobManager: this.deps.jobManager,  // Add this
    turnId,
    turnSeq: toolTurnSeq,
  }
);
```

**Step 2: Update RunnerDependencies to include jobManager**

```typescript
// In types.ts, update RunnerDependencies:
import type { JobManager } from '@lace/agent/jobs/job-manager';

export interface RunnerDependencies {
  // ... existing deps ...
  jobManager: JobManager;
}
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat(agent): pass jobManager through ToolContext in runner"
```

---

## Task 13: Remove Special Tool Handling from Runner

**Files:**
- Modify: `packages/agent/src/core/conversation/runner.ts`

**Step 1: Delete executeDelegateTool method**

Remove the entire `executeDelegateTool()` private method (~80 lines).

**Step 2: Delete special tool handling in executeToolByName**

Remove these blocks from `executeToolByName`:

```typescript
// DELETE THIS:
if (toolName === 'delegate') {
  return await this.executeDelegateTool({ finalInput, toolTurnSeq, abortController, turnId });
}

// DELETE THIS:
if (toolName === 'job_output' || toolName === 'jobs_list' || toolName === 'job_kill') {
  // ... all of this
}

// DELETE THIS:
if (toolName === 'todo_read' || toolName === 'todo_write') {
  // ... all of this
}
```

All tools now go through the default `toolExecutor.execute()` path.

**Step 3: Delete createJobToolContext method**

Remove the `createJobToolContext()` private method - no longer needed.

**Step 4: Run tests**

```bash
npm test -- --run
```

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor(agent): remove special tool handling from runner

All tools now flow through toolExecutor.execute() with jobManager in context.
"
```

---

## Task 14: Delete Dead Code

**Files:**
- Delete: `packages/agent/src/core/tools/special/` (entire directory)
- Modify: `packages/agent/src/index.ts` (remove exports)
- Delete: `packages/agent/src/jobs/job-creation.ts` (replaced by JobManager)
- Delete: `packages/agent/src/jobs/job-derivation.ts` (replaced by JobManager)
- Delete: `packages/agent/src/jobs/job-control.ts` (replaced by JobManager)

**Step 1: Delete core/tools/special directory**

```bash
rm -rf packages/agent/src/core/tools/special
```

**Step 2: Update index.ts exports**

Remove from `packages/agent/src/index.ts`:

```typescript
// DELETE THIS LINE:
export { isSpecialTool, executeSpecialTool } from './core/tools/special';
```

**Step 3: Delete superseded jobs files**

```bash
rm packages/agent/src/jobs/job-creation.ts
rm packages/agent/src/jobs/job-derivation.ts
rm packages/agent/src/jobs/job-control.ts
```

**Step 4: Update jobs/index.ts exports**

Remove exports for deleted files, add JobManager export:

```typescript
// packages/agent/src/jobs/index.ts
export { JobManager } from './job-manager';
export { getJobOutputPath, ensureJobLogDir } from './job-file-utils';
export { readJobOutputTail } from './job-output';
// ... keep other exports that are still used
```

**Step 5: Run tests**

```bash
npm test -- --run
```

**Step 6: Commit**

```bash
git add -A
git commit -m "refactor(agent): delete dead code after JobManager consolidation

- Removed core/tools/special/ (was never called)
- Removed job-creation.ts, job-derivation.ts, job-control.ts (consolidated into JobManager)
"
```

---

## Task 15: Update All Callers of Old Job APIs

**Files:**
- Various files that imported from deleted modules

**Step 1: Find all broken imports**

```bash
npm run build 2>&1 | grep "Cannot find module"
```

**Step 2: Update each file to use JobManager**

For each broken import:
- If it was using `createShellJob`/`createSubagentJob` → use `jobManager.createJob()`
- If it was using `createJobDerivation` → use `jobManager.listJobs()`
- If it was using functions from `job-control.ts` → use `jobManager` methods

**Step 3: Run full test suite**

```bash
npm test -- --run
```

**Step 4: Run build**

```bash
npm run build
```

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor(agent): update all callers to use JobManager"
```

---

## Task 16: Final Cleanup and Documentation

**Files:**
- Update: `packages/agent/src/jobs/index.ts`
- Update any relevant documentation

**Step 1: Ensure clean exports from jobs/**

```typescript
// packages/agent/src/jobs/index.ts
// ABOUTME: Job management exports

export { JobManager, type JobManagerDeps, type JobRecord, type CreateJobOptions, JobCreationError } from './job-manager';
export { getJobOutputPath, ensureJobLogDir, getLastLines } from './job-file-utils';
export { readJobOutputTail } from './job-output';
export { formatJobNotification } from './format-notification';
```

**Step 2: Run full test suite**

```bash
npm test -- --run
```

**Step 3: Run linter**

```bash
npm run lint
```

**Step 4: Final commit**

```bash
git add -A
git commit -m "refactor(agent): complete JobManager consolidation

JobManager now owns all job state and operations:
- createJob(type, options) - unified job creation
- listJobs() - replaces deriveJobs()
- getJob(), addJob(), removeJob()
- cancelJob(), finalizeJob()
- getJobOutput()
- notification queue management

All tools flow through toolExecutor.execute() with jobManager in context.
Deleted ~500 lines of dead/duplicate code.
"
```

---

## Summary

This plan consolidates scattered job management into a unified `JobManager` class:

1. **Tasks 1-7:** Build JobManager with all state and operations
2. **Tasks 8-9:** Wire JobManager into the system (ToolContext, AgentServerState)
3. **Tasks 10-11:** Implement real `executeValidated()` in tool classes
4. **Tasks 12-13:** Update runner to pass context and remove special handling
5. **Tasks 14-16:** Delete dead code and clean up

**Result:**
- One place for job state and operations (`JobManager`)
- One code path for tool execution (`toolExecutor.execute()`)
- ~500 lines of dead/duplicate code deleted
- Clear separation: JobManager is session-scoped service, tools use it via context
