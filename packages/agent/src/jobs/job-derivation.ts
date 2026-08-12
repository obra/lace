// ABOUTME: Derives job state from durable events.
// Parses the session's transcript (legacy + new layout) to reconstruct job history.
// Includes caching to avoid re-parsing on repeated calls.

import type { JobType, JobStatus, JobState } from '../server-types';
import { toNonEmptyString } from '../rpc/utils';
import { parseRuntimeExecutionBinding } from '../tools/runtime/validation';
import type { RuntimeExecutionBinding } from '../tools/runtime/types';
import { readAllSessionEventLines } from '../storage/event-log';

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
  runtimeBinding?: RuntimeExecutionBinding;
  persona?: string;
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
 * A job the log says is running but the running-jobs map doesn't know about
 * means the process restarted after the job started; the true outcome is
 * unknown, so report 'interrupted', never an invented 'failed'.
 */
function applyRunningJobStatus(
  jobs: DerivedJob[],
  runningJobs: Map<string, JobState>
): DerivedJob[] {
  return jobs.map((job) => {
    if (job.status === 'running' && !runningJobs.has(job.jobId)) {
      return { ...job, status: 'interrupted' as JobStatus };
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

    // Pull every line from both legacy and new layouts; the dual-read helper
    // returns them in eventSeq order. Cache by sessionId + lineCount: line
    // counts grow monotonically with appends, so any change busts the cache.
    const lines = readAllSessionEventLines(sessionDir);
    const lineCount = lines.length;

    const runningJobs = deps.getRunningJobs();

    if (
      cache &&
      cache.sessionId === sessionId &&
      cache.fileSize === lineCount &&
      cache.fileMtime === 0
    ) {
      return applyRunningJobStatus(cache.result, runningJobs);
    }

    const byId = new Map<string, DerivedJob>();

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
          let runtimeBinding: RuntimeExecutionBinding | undefined;
          if (data.runtimeBinding !== undefined) {
            try {
              runtimeBinding = parseRuntimeExecutionBinding(data.runtimeBinding);
            } catch {
              runtimeBinding = undefined;
            }
          }
          byId.set(jobId, {
            jobId,
            parentJobId: toNonEmptyString(data.parentJobId) ?? undefined,
            type: jobType,
            status: 'running',
            description: toNonEmptyString(data.description) ?? undefined,
            command: toNonEmptyString(data.command) ?? undefined,
            startTime,
            ...(runtimeBinding ? { runtimeBinding } : {}),
            persona: toNonEmptyString(data.persona) ?? undefined,
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

    // Update cache with parsed results (before applying running status updates).
    // fileSize holds the lineCount; fileMtime is unused (always 0).
    const parsedResult = Array.from(byId.values());
    cache = {
      sessionId,
      fileSize: lineCount,
      fileMtime: 0,
      result: parsedResult,
    };

    return applyRunningJobStatus(parsedResult, runningJobs);
  };
}

/**
 * One-shot derivation of the jobs the process that JUST died left in flight.
 * Used by crash recovery to tell the agent what was interrupted; reads only
 * the durable log, so it works before the session is active.
 *
 * Scoped to the latest crash generation: a job orphaned by an EARLIER crash
 * never gets a job_finished, so it stays log-running forever. Only jobs
 * started after the previous session-recovered marker can have been owned by
 * the process that just died.
 */
export function listInterruptedJobs(sessionDir: string): DerivedJob[] {
  const lines = readAllSessionEventLines(sessionDir);

  const inFlight = new Map<string, DerivedJob>();
  for (const line of lines) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as { type?: string; timestamp?: string; data?: unknown };
      const data = (parsed.data ?? {}) as Record<string, unknown>;

      if (parsed.type === 'context_injected') {
        const content = Array.isArray(data.content) ? (data.content as unknown[]) : [];
        // Anchored to the notification wrapper's opening tag so quoted
        // mentions of the kind inside some other injected body can never
        // register as a crash boundary.
        const isRecoveryMarker = content.some(
          (c) =>
            typeof (c as { text?: unknown }).text === 'string' &&
            /^<notification\s+kind="session-recovered"/.test((c as { text: string }).text)
        );
        // Everything before this marker belongs to an earlier crash
        // generation and was already reported by it.
        if (isRecoveryMarker) inFlight.clear();
        continue;
      }

      if (parsed.type !== 'job_started' && parsed.type !== 'job_finished') continue;
      const jobId = toNonEmptyString(data.jobId);
      if (!jobId) continue;

      if (parsed.type === 'job_started') {
        inFlight.set(jobId, {
          jobId,
          type: data.jobType === 'delegate' ? 'delegate' : 'bash',
          status: 'interrupted',
          description: toNonEmptyString(data.description) ?? undefined,
          startTime:
            typeof parsed.timestamp === 'string' ? parsed.timestamp : new Date().toISOString(),
        });
      } else {
        inFlight.delete(jobId);
      }
    } catch {
      // Ignore malformed lines.
    }
  }

  return Array.from(inFlight.values());
}
