// ABOUTME: Derives job state from durable events.
// Parses events.jsonl to reconstruct job history for a session.
// Includes caching to avoid re-parsing on repeated calls.

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { JobType, JobStatus, JobState } from '../server-types';
import { toNonEmptyString } from '../rpc/utils';

/**
 * A derived job record from events.
 */
export type DerivedJob = {
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
 * Cache entry for derived jobs.
 */
type JobsCache = {
  sessionId: string;
  fileSize: number;
  fileMtime: number;
  result: DerivedJob[];
};

/**
 * Apply running job status updates from in-memory state.
 * Jobs marked as 'running' in events but not in the running jobs map are marked as 'failed'.
 */
function applyRunningJobStatus(
  jobs: DerivedJob[],
  runningJobs: Map<string, JobState>
): DerivedJob[] {
  return jobs.map((job) => {
    if (job.status === 'running' && !runningJobs.has(job.jobId)) {
      return { ...job, status: 'failed' as JobStatus };
    }
    return job;
  });
}

/**
 * Creates a job derivation function with its own cache.
 * The cache avoids re-parsing events.jsonl on every call.
 */
export function createJobDerivation(deps: {
  /** Get the active session directory and ID, or null if none. */
  getActiveSession: () => { sessionId: string; dir: string } | null;
  /** Get running jobs to check if a 'running' job is still actually running. */
  getRunningJobs: () => Map<string, JobState>;
}): () => DerivedJob[] {
  let cache: JobsCache | null = null;

  return (): DerivedJob[] => {
    const activeSession = deps.getActiveSession();
    if (!activeSession) return [];

    const { sessionId, dir: sessionDir } = activeSession;
    const eventsPath = join(sessionDir, 'events.jsonl');

    // Check cache validity
    let fileSize = 0;
    let fileMtime = 0;
    try {
      const stats = statSync(eventsPath);
      fileSize = stats.size;
      fileMtime = stats.mtimeMs;
    } catch {
      return [];
    }

    const runningJobs = deps.getRunningJobs();

    if (
      cache &&
      cache.sessionId === sessionId &&
      cache.fileSize === fileSize &&
      cache.fileMtime === fileMtime
    ) {
      return applyRunningJobStatus(cache.result, runningJobs);
    }

    // Cache miss - read and parse the file
    let raw = '';
    try {
      raw = readFileSync(eventsPath, 'utf8');
    } catch {
      return [];
    }

    const byId = new Map<string, DerivedJob>();

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
        // Ignore malformed lines.
      }
    }

    // Update cache with parsed results (before applying running status updates)
    const parsedResult = Array.from(byId.values());
    cache = {
      sessionId,
      fileSize,
      fileMtime,
      result: parsedResult,
    };

    return applyRunningJobStatus(parsedResult, runningJobs);
  };
}
