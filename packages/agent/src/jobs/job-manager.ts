// ABOUTME: Unified job management - state, operations, and notifications
// Consolidates scattered job code into single session-scoped service

import { randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { JobState, JobStatus, JobType, PendingJobNotification } from '../server-types';
import { MAX_CONCURRENT_JOBS } from '../server-types';
import type { PersonaContainerRuntime, PersonaBoxRuntime } from './persona-container-spec';
import { toNonEmptyString } from '../rpc/utils';
import { getJobOutputPath } from './job-file-utils';

export type JobManagerDeps = {
  getActiveSession: () => { sessionId: string; dir: string } | null;
  persistEvent: (event: { type: string; data: Record<string, unknown> }) => Promise<void>;
  emitUpdate: (update: { type: string; [key: string]: unknown }) => Promise<void>;
  runShellProcess: (job: JobState) => void;
  runSubagentProcess: (job: JobState) => void;
  setupProgressTimer?: (job: JobState) => void;
};

/**
 * Options for creating a job via createJob().
 */
export type CreateJobOptions = {
  command?: string; // for shell
  prompt?: string; // for delegate
  description?: string;
  parentJobId?: string;
  turnContext?: { turnId: string; turnSeq: number };
  resumeSessionId?: string; // for delegate resume
  connectionId?: string;
  modelId?: string;
  progressIntervalMs?: number;
  // Persona-bundle support for delegate jobs
  persona?: string;
  // Parsed persona container runtime, forwarded to subagent-job when present.
  personaContainerRuntime?: PersonaContainerRuntime;
  // Parsed persona box runtime (kata #62). Mutually exclusive with
  // personaContainerRuntime at the persona level.
  personaBoxRuntime?: PersonaBoxRuntime;
};

/**
 * Error thrown when job creation fails.
 */
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

/**
 * A job record derived from events.
 */
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

/**
 * Cache entry for listJobs results.
 */
type JobsCache = {
  sessionId: string;
  fileSize: number;
  fileMtime: number;
  result: JobRecord[];
};

export class JobManager {
  private jobs = new Map<string, JobState>();
  private streamingMode: 'full' | 'coalesced' | 'none' = 'full';
  private notificationQueue: PendingJobNotification[] = [];
  private deps: JobManagerDeps;
  private listJobsCache: JobsCache | null = null;

  constructor(deps: JobManagerDeps) {
    this.deps = deps;
  }

  /**
   * List all jobs for the active session by reconstructing from events.jsonl.
   * Results are cached and only re-parsed when the file changes.
   */
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
      // File doesn't exist - return empty
      return [];
    }

    // Check if cache is valid
    if (
      this.listJobsCache &&
      this.listJobsCache.sessionId === sessionId &&
      this.listJobsCache.fileSize === fileSize &&
      this.listJobsCache.fileMtime === fileMtime
    ) {
      return this.applyRunningStatus(this.listJobsCache.result);
    }

    // Cache miss - read and parse the file
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
        const parsed = JSON.parse(line) as { type?: string; timestamp?: string; data?: unknown };
        if (
          parsed.type !== 'job_started' &&
          parsed.type !== 'job_finished' &&
          parsed.type !== 'job_session_assigned'
        ) {
          continue;
        }

        const timestamp = typeof parsed.timestamp === 'string' ? parsed.timestamp : undefined;
        const data = (parsed.data ?? {}) as Record<string, unknown>;
        const jobId = toNonEmptyString(data.jobId);
        if (!jobId) continue;

        if (parsed.type === 'job_started') {
          const jobType = data.jobType === 'delegate' ? 'delegate' : 'bash';
          const startTime = timestamp ?? new Date().toISOString();
          byId.set(jobId, {
            jobId,
            parentJobId: toNonEmptyString(data.parentJobId) ?? undefined,
            type: jobType,
            status: 'running',
            description: toNonEmptyString(data.description) ?? undefined,
            command: toNonEmptyString(data.command) ?? undefined,
            startTime,
          });
        } else if (parsed.type === 'job_session_assigned') {
          const existing = byId.get(jobId);
          const subagentSessionId = toNonEmptyString(data.subagentSessionId);
          if (existing && subagentSessionId) {
            existing.subagentSessionId = subagentSessionId;
          }
        } else {
          // job_finished
          const existing = byId.get(jobId);
          const exitCode = typeof data.exitCode === 'number' ? data.exitCode : undefined;
          const outcome =
            data.outcome === 'completed' ||
            data.outcome === 'failed' ||
            data.outcome === 'cancelled'
              ? data.outcome
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

    // Update cache with parsed results (before applying running status updates)
    const parsedResult = Array.from(byId.values());
    this.listJobsCache = {
      sessionId,
      fileSize,
      fileMtime,
      result: parsedResult,
    };

    return this.applyRunningStatus(parsedResult);
  }

  /**
   * Apply running job status updates from in-memory state.
   * Jobs marked as 'running' in events but not in the running jobs map are marked as 'failed'.
   */
  private applyRunningStatus(jobs: JobRecord[]): JobRecord[] {
    return jobs.map((job) => {
      if (job.status === 'running' && !this.jobs.has(job.jobId)) {
        return { ...job, status: 'failed' as JobStatus };
      }
      return job;
    });
  }

  getStreamingMode(): 'full' | 'coalesced' | 'none' {
    return this.streamingMode;
  }

  setStreamingMode(mode: 'full' | 'coalesced' | 'none'): void {
    this.streamingMode = mode;
  }

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

  /**
   * Clear all running jobs from the in-memory map.
   * Used when closing a session.
   */
  clearJobs(): void {
    this.jobs.clear();
  }

  /**
   * Finalize a job - mark as finished, persist event, emit update, and remove from running jobs.
   * This is called when a job completes, fails, or is cancelled.
   */
  async finalizeJob(job: JobState): Promise<void> {
    if (job.finished) return;
    job.finished = true;

    await this.deps.persistEvent({
      type: 'job_finished',
      data: {
        jobId: job.jobId,
        ...(job.parentJobId ? { parentJobId: job.parentJobId } : {}),
        outcome: job.status,
        ...(typeof job.exitCode === 'number' ? { exitCode: job.exitCode } : {}),
      },
    });

    await this.deps.emitUpdate({
      type: 'job_finished',
      jobId: job.jobId,
      ...(job.parentJobId ? { parentJobId: job.parentJobId } : {}),
      outcome: job.status,
      ...(typeof job.exitCode === 'number' ? { exitCode: job.exitCode } : {}),
    });

    job.resolveCompletion?.();
    this.jobs.delete(job.jobId);
  }

  /**
   * Cancel a job by ID - sets status to cancelled and finalizes it.
   */
  async cancelJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.status = 'cancelled';
    await this.finalizeJob(job);
  }

  /**
   * Read the output from a job's log file.
   * Returns empty string if no active session or file doesn't exist.
   */
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

  /**
   * Queue a notification for delivery to the agent.
   */
  queueNotification(notification: PendingJobNotification): void {
    this.notificationQueue.push(notification);
  }

  /**
   * Flush all queued notifications, returning them and clearing the queue.
   * Used when injecting notifications before a prompt.
   */
  flushNotifications(): PendingJobNotification[] {
    return this.notificationQueue.splice(0);
  }

  /**
   * Get the current notification queue.
   * Returns a reference to the actual queue for checking length.
   */
  getNotificationQueue(): PendingJobNotification[] {
    return this.notificationQueue;
  }

  /**
   * Create a new job (shell or delegate) and start it.
   * Returns the job ID immediately; the job runs asynchronously.
   */
  async createJob(
    type: 'shell' | 'delegate',
    options: CreateJobOptions
  ): Promise<{ jobId: string; job: JobState }> {
    // 1. Check for active session
    const activeSession = this.deps.getActiveSession();
    if (!activeSession) {
      throw new JobCreationError('No active session', -32001, 'session');
    }

    // 2. Check max concurrent jobs limit
    const runningJobCount = [...this.jobs.values()].filter((j) => j.status === 'running').length;
    if (runningJobCount >= MAX_CONCURRENT_JOBS) {
      throw new JobCreationError(
        `Maximum concurrent jobs (${MAX_CONCURRENT_JOBS}) exceeded`,
        -32003,
        'session'
      );
    }

    // 3. Generate jobId and create JobState
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
      progressIntervalMs: options.progressIntervalMs,
      connectionId: options.connectionId,
      modelId: options.modelId,
      ...(type === 'delegate'
        ? {
            subagentContent: [{ type: 'text', text: options.prompt }],
            ...(options.resumeSessionId ? { subagentSessionId: options.resumeSessionId } : {}),
            ...(options.persona ? { persona: options.persona } : {}),
            ...(options.personaContainerRuntime
              ? { personaContainerRuntime: options.personaContainerRuntime }
              : {}),
            ...(options.personaBoxRuntime ? { personaBoxRuntime: options.personaBoxRuntime } : {}),
          }
        : {}),
    };

    // 4. Add to jobs map
    this.jobs.set(jobId, job);

    // 5. Persist job_started event
    await this.deps.persistEvent({
      type: 'job_started',
      data: {
        jobId,
        parentJobId: options.parentJobId,
        jobType,
        description,
        command,
        turnContext: options.turnContext,
      },
    });

    // 6. Emit job_started update
    await this.deps.emitUpdate({
      type: 'job_started',
      jobId,
      parentJobId: options.parentJobId,
      jobType,
      description,
    });

    // 7. Set up progress timer if configured
    this.deps.setupProgressTimer?.(job);

    // 8. Call runShellProcess or runSubagentProcess
    if (type === 'shell') {
      this.deps.runShellProcess(job);
    } else {
      this.deps.runSubagentProcess(job);
    }

    // 9. Return { jobId, job }
    return { jobId, job };
  }
}
