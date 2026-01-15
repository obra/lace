// ABOUTME: Unified job management - state, operations, and notifications
// Consolidates scattered job code into single session-scoped service

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { JobState, JobStatus, JobType, PendingJobNotification } from '../server-types';
import { toNonEmptyString } from '../rpc/utils';

export type JobManagerDeps = {
  getActiveSession: () => { sessionId: string; dir: string } | null;
  persistEvent: (event: { type: string; data: Record<string, unknown> }) => Promise<void>;
  emitUpdate: (update: { type: string; [key: string]: unknown }) => Promise<void>;
};

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
}
