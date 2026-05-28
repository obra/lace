// ABOUTME: Unified job management - state, operations, and notifications
// Consolidates scattered job code into single session-scoped service

import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type {
  ContainerExecutionIdentityConfig,
  ContainerExecutionMetadata,
  JobState,
  JobStatus,
  JobType,
  JobNotificationType,
} from '../server-types';
import { MAX_CONCURRENT_JOBS } from '../server-types';
import { toNonEmptyString } from '../rpc/utils';
import { getJobOutputPath } from './job-file-utils';
import type { RuntimeExecutionBinding } from '../tools/runtime/types';
import { readAllSessionEventLines } from '../storage/event-log';
import type { SessionId } from '@lace/ent-protocol';
import { resolveContainerId } from '../containers/container-manager';
import { fingerprintContainerExecutionToken } from './container-execution-metadata';
import { logger } from '../utils/logger';

// Same POSIX-ish convention used by initialize.ts for containerExecutionIdentity.
// Host-supplied env var names must look like real env vars; values may be any string.
const SPAWN_ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

export type JobManagerDeps = {
  getActiveSession: () => { sessionId: string; dir: string } | null;
  persistEvent: (event: { type: string; data: Record<string, unknown> }) => Promise<void>;
  emitUpdate: (update: { type: string; [key: string]: unknown }) => Promise<void>;
  runShellProcess: (job: JobState) => void;
  runSubagentProcess: (job: JobState) => void;
  setupProgressTimer?: (job: JobState) => void;
  /**
   * Optional: ask the embedder (e.g. sen-core) for per-spawn env vars to merge
   * into the delegate container's executionEnv. Called once per delegate job,
   * after lace has computed the base executionEnv. Returns extra env vars; the
   * caller merges them with conflict resolution and shape validation applied.
   * If the embedder doesn't implement `host/spawn/env`, the implementation
   * should resolve to {} (or reject — JobManager treats either as no-op + warn
   * and never blocks the spawn). See PRI-1867 M4.
   */
  fetchEmbedderSpawnEnv?: (request: {
    jobId: string;
    persona: string;
    parentSessionId: string;
    runtimeId?: string;
  }) => Promise<Record<string, string>>;
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
  // Host-preallocated session id for the fresh-spawn case (PRI-1796).
  // Mutually exclusive with resumeSessionId.
  newSubagentSessionId?: string;
  connectionId?: string;
  modelId?: string;
  progressIntervalMs?: number;
  runtimeBinding?: RuntimeExecutionBinding;
  // Host scratch-directory path reserved for this invocation (PRI-1796).
  scratchDirHostPath?: string;
  // Container-sharing mode for this delegate job (PRI-1796).
  containerSharing?: 'per_invocation' | 'persistent';
  // Persona-bundle support for delegate jobs
  persona?: string;
  // Per-invocation container spec name for the idle-TTL reaper (PRI-1796).
  // Computed by delegate.ts and stored here so maybeScheduleReapAfter can
  // use it without reconstructing the projected container binding.
  containerSpecName?: string;
  containerExecutionIdentity?: ContainerExecutionIdentityConfig;
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

/**
 * A subscription registered via `job_notify`. Tracks which lifecycle kinds
 * the parent wants to be woken on for a given jobId.
 *
 * Phase 1 of PRI-1692: subscriptions exist for the four
 * `JobNotificationType` kinds. `filter` is accepted but no-op on terminal
 * states (Phase 2 will use it for progress / per-line subscriptions).
 */
export type JobSubscription = {
  subscriptionId: string;
  jobId: string;
  on: readonly JobNotificationType[];
  filter?: string;
  // Compiled form of `filter` (multi-line, so `^X` matches a line inside a
  // multi-line preview). Built once at subscribe time; null when no filter
  // is set. Phase 2 of PRI-1692.
  filterRegex?: RegExp;
};

export type SubscribeOptions = {
  jobId: string;
  on: readonly JobNotificationType[];
  filter?: string;
};

/**
 * Pending per-subscription progress batch (PRI-1692 Phase 2). When a
 * subscription receives its first `progress` fanout, a 200ms timer is
 * armed; further progress within the window replaces `inject` (latest
 * call wins, carrying the latest preview). The timer fires the buffered
 * inject() to write the durable event, or a terminal-state fanout
 * flushes it early.
 */
type ProgressBatch = {
  inject: () => void;
  timer: ReturnType<typeof setTimeout>;
};

const PROGRESS_BATCH_WINDOW_MS = 200;

/**
 * Merge embedder-supplied env vars into the base executionEnv from
 * buildContainerExecutionContext.
 *
 * Filters out:
 *   - names that don't match SPAWN_ENV_NAME_PATTERN (warn + drop)
 *   - names that collide with anything already in base (lace-managed env vars
 *     like SEN_AGENT_TOKEN; warn + drop the embedder value)
 *   - non-string values (warn + drop)
 *
 * Returns a fresh map; never mutates `base`. Caller decides whether to assign
 * the result onto the JobState.
 */
function mergeEmbedderSpawnEnv(
  base: Record<string, string>,
  embedderEnv: Record<string, string>,
  jobId: string
): Record<string, string> {
  const merged: Record<string, string> = { ...base };
  for (const [name, value] of Object.entries(embedderEnv)) {
    if (typeof value !== 'string') {
      logger.warn('host_spawn_env.malformed_value_dropped', {
        jobId,
        name,
        actualType: typeof value,
      });
      continue;
    }
    if (!SPAWN_ENV_NAME_PATTERN.test(name)) {
      logger.warn('host_spawn_env.malformed_name_dropped', { jobId, name });
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(merged, name)) {
      logger.warn('host_spawn_env.conflict_with_lace_managed_dropped', { jobId, name });
      continue;
    }
    merged[name] = value;
  }
  return merged;
}

function buildContainerExecutionContext(input: {
  identity?: ContainerExecutionIdentityConfig;
  jobId: string;
  persona?: string;
  parentSessionId: string;
  runtimeBinding?: RuntimeExecutionBinding;
  containerSpecName?: string;
}): { executionEnv: Record<string, string>; metadata: ContainerExecutionMetadata } | undefined {
  if (!input.identity || !input.persona) return undefined;
  if (input.runtimeBinding?.toolRuntime.type !== 'container') {
    return undefined;
  }

  const token = randomBytes(32).toString('base64url');
  const containerId = resolveContainerId(input.runtimeBinding.toolRuntime.spec);
  return {
    executionEnv: { [input.identity.tokenEnvName]: token },
    metadata: {
      tokenEnvName: input.identity.tokenEnvName,
      tokenFingerprint: fingerprintContainerExecutionToken(token),
      personaName: input.persona,
      parentSessionId: input.parentSessionId as SessionId,
      jobId: input.jobId,
      ...(input.runtimeBinding?.identity.runtimeId
        ? { runtimeId: input.runtimeBinding.identity.runtimeId }
        : {}),
      ...(input.containerSpecName ? { containerSpecName: input.containerSpecName } : {}),
      ...(containerId ? { containerId } : {}),
    },
  };
}

export class JobManager {
  private jobs = new Map<string, JobState>();
  private streamingMode: 'full' | 'coalesced' | 'none' = 'full';
  private deps: JobManagerDeps;
  private listJobsCache: JobsCache | null = null;
  private subscriptions = new Map<string, JobSubscription>();
  private subscriptionsByJob = new Map<string, Set<string>>();
  // Per-subscription batched progress (see ProgressBatch above).
  private progressBatches = new Map<string, ProgressBatch>();

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

    // Pull every line from both legacy and new layouts; dual-read returns
    // them in eventSeq order. Cache by sessionId + lineCount as a cheap
    // change detector; line count is monotonic, so any append busts the cache.
    const lines = readAllSessionEventLines(sessionDir);
    const lineCount = lines.length;

    if (
      this.listJobsCache &&
      this.listJobsCache.sessionId === sessionId &&
      this.listJobsCache.fileSize === lineCount &&
      this.listJobsCache.fileMtime === 0
    ) {
      return this.applyRunningStatus(this.listJobsCache.result);
    }

    const byId = new Map<string, JobRecord>();

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

    // Update cache with parsed results (before applying running status updates).
    // We piggyback on the (sessionId, fileSize, fileMtime) shape: fileSize is
    // the line count, fileMtime is always 0 — sufficient because line counts
    // grow monotonically with appends.
    const parsedResult = Array.from(byId.values());
    this.listJobsCache = {
      sessionId,
      fileSize: lineCount,
      fileMtime: 0,
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
    // Honor any pre-existing progress subscriptions registered against this
    // jobId before the job was added (PRI-1707). subscribe() accepts
    // unknown jobIds, so a caller can legitimately register progress
    // interest before the job lands in the map; without this hook the
    // timer would never arm.
    if (this.hasProgressSubscriber(job.jobId)) {
      this.startProgressTimerIfNeeded(job.jobId);
    }
  }

  getJob(jobId: string): JobState | undefined {
    return this.jobs.get(jobId);
  }

  removeJob(jobId: string): void {
    const job = this.jobs.get(jobId);
    this.jobs.delete(jobId);
    this.clearSubscriptionsForJob(jobId);
    // Subscriptions were the only thing keeping this timer armed; with the
    // job gone, the operator's explicit-interval branch can't reach it
    // either. Stop unconditionally.
    if (job) this.stopProgressTimer(job);
  }

  getRunningJobs(): Map<string, JobState> {
    return this.jobs;
  }

  /**
   * Clear all running jobs from the in-memory map.
   * Used when closing a session.
   */
  clearJobs(): void {
    // Stop every armed progress timer before dropping the jobs. The
    // setInterval handles live in createSetupProgressTimer's closure and
    // won't get GC'd just because we drop the JobState reference.
    for (const job of this.jobs.values()) {
      this.stopProgressTimer(job);
    }
    this.jobs.clear();
    // Cancel every armed progress batch before dropping the subscriptions
    // they belong to — leaving a setTimeout pending would deliver after the
    // subscription is gone.
    for (const batch of this.progressBatches.values()) {
      clearTimeout(batch.timer);
    }
    this.progressBatches.clear();
    this.subscriptions.clear();
    this.subscriptionsByJob.clear();
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
    // Stop the progress timer before dropping the job. createFinalizeJob in
    // the notifications path also clears it on the happy path; doing it
    // here too keeps the internal finalize entry point self-contained.
    this.stopProgressTimer(job);
    this.jobs.delete(job.jobId);
    // Prune any subscriptions for this jobId. Fanout (if any) has already
    // fired upstream via createFinalizeJob in the notifications path — by
    // the time we reach this internal finalize, the job is dead and no
    // future fanout for this jobId is possible.
    this.clearSubscriptionsForJob(job.jobId);
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
   * Register a subscription so the parent agent is woken when this job
   * transitions to one of the listed lifecycle kinds. Idempotent: a second
   * call with the same args returns the existing subscription.
   *
   * Once a job has at least one subscription, terminal-state notifications
   * are routed through `fanoutToInject()` instead of the always-on inject
   * fallback. Subscribing to `on=['failed']` and watching a job complete
   * successfully therefore produces NO notification — "silence is not
   * success" is the coverage-discipline contract documented in the design.
   */
  subscribe(opts: SubscribeOptions): JobSubscription {
    const existing = this.findSubscription(opts);
    if (existing) return existing;

    // Compile the filter regex up-front. Invalid patterns are rejected at
    // subscribe time so the agent gets a clear error rather than silently
    // dropping every progress event. Multi-line flag lets `^X` match line
    // boundaries inside the preview.
    let filterRegex: RegExp | undefined;
    if (opts.filter !== undefined) {
      try {
        filterRegex = new RegExp(opts.filter, 'm');
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`Invalid filter regex "${opts.filter}": ${reason}`);
      }
    }

    const sub: JobSubscription = {
      subscriptionId: `sub_${randomUUID()}`,
      jobId: opts.jobId,
      on: [...opts.on],
      ...(opts.filter !== undefined ? { filter: opts.filter } : {}),
      ...(filterRegex ? { filterRegex } : {}),
    };
    this.subscriptions.set(sub.subscriptionId, sub);
    let byJob = this.subscriptionsByJob.get(opts.jobId);
    if (!byJob) {
      byJob = new Set();
      this.subscriptionsByJob.set(opts.jobId, byJob);
    }
    byJob.add(sub.subscriptionId);
    // PRI-1707: the progress timer is opt-in. A new subscription that
    // includes 'progress' is the demand signal that arms it; jobs without
    // an operator-configured cadence and without progress subscribers
    // stay silent.
    if (sub.on.includes('progress')) {
      this.startProgressTimerIfNeeded(opts.jobId);
    }
    return sub;
  }

  /**
   * Remove a subscription. After unsubscribe, a job with no remaining
   * subscriptions reverts to the always-on inject-fallback path.
   */
  unsubscribe(subscriptionId: string): void {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) return;
    this.cancelProgressBatch(subscriptionId);
    this.subscriptions.delete(subscriptionId);
    const byJob = this.subscriptionsByJob.get(sub.jobId);
    if (byJob) {
      byJob.delete(subscriptionId);
      if (byJob.size === 0) this.subscriptionsByJob.delete(sub.jobId);
    }
    // PRI-1707: if this was the last progress subscriber for the job, the
    // timer is no longer needed. Operator-configured cadences (explicit
    // progressIntervalMs) outlive subscriber churn and are left alone here.
    if (sub.on.includes('progress')) {
      this.stopProgressTimerIfUnused(sub.jobId);
    }
  }

  /**
   * Deliver a job-lifecycle notification via the inject callback.
   *
   * If at least one subscription exists for `jobId`, every subscription
   * whose `on` set contains `kind` triggers exactly one `inject()` call
   * (subject to filter + 200ms progress batching). Subscriptions that
   * don't match `kind` do NOT deliver — the parent opted into selective
   * coverage.
   *
   * If no subscription exists for `jobId`, `inject()` is invoked once as
   * the always-on fallback so unsubscribed jobs still wake the parent on
   * terminal states.
   *
   * The progress batch buffers the most recent `inject` closure — when
   * multiple progress fanouts land inside a 200ms window for the same
   * subscription, only the latest closure runs (latest tail-preview wins).
   */
  fanoutToInject(
    jobId: string,
    kind: JobNotificationType,
    options: { preview?: string },
    inject: () => void
  ): void {
    const subIds = this.subscriptionsByJob.get(jobId);
    if (!subIds || subIds.size === 0) {
      inject();
      return;
    }

    // Terminal-state fanout: flush every pending progress batch for THIS
    // job's subscriptions before iterating, even subs whose `on` does not
    // include the terminal kind. Otherwise a progress-only sub's buffered
    // batch keeps ticking past the terminal and fires a stale "phantom"
    // delivery 200ms after the job has already died.
    if (kind !== 'progress') {
      for (const subId of subIds) {
        this.flushProgressBatch(subId);
      }
    }

    for (const subId of subIds) {
      const sub = this.subscriptions.get(subId);
      if (!sub) continue;
      if (!sub.on.includes(kind)) continue;
      // Filter applies ONLY to 'progress'. Terminal-state kinds always
      // fire regardless of filter — the "silence is not success" contract
      // requires they're never filterable.
      if (kind === 'progress') {
        if (sub.filterRegex) {
          const preview = options.preview ?? '';
          if (!sub.filterRegex.test(preview)) continue;
        }
        this.bufferProgressForSubscription(sub.subscriptionId, inject);
      } else {
        // Terminal: batches were already flushed above. Just inject.
        inject();
      }
    }
  }

  /**
   * Buffer a matching progress inject closure for a subscription, arming
   * the 200ms flush timer on the first event of a new window. Subsequent
   * events within the window replace the buffered closure — latest
   * preview wins, matching the LLM's actual need (most recent tail, not
   * stale history).
   */
  private bufferProgressForSubscription(subscriptionId: string, inject: () => void): void {
    const existing = this.progressBatches.get(subscriptionId);
    if (existing) {
      existing.inject = inject;
      return;
    }
    const timer = setTimeout(() => {
      this.flushProgressBatch(subscriptionId);
    }, PROGRESS_BATCH_WINDOW_MS);
    this.progressBatches.set(subscriptionId, { inject, timer });
  }

  /**
   * Fire the buffered inject closure (if any) and clear the per-subscription
   * batch state. Called by the 200ms timer, on terminal fanout for the same
   * subscription, and on subscription teardown.
   */
  private flushProgressBatch(subscriptionId: string): void {
    const batch = this.progressBatches.get(subscriptionId);
    if (!batch) return;
    clearTimeout(batch.timer);
    this.progressBatches.delete(subscriptionId);
    batch.inject();
  }

  /**
   * Cancel any pending batch for `subscriptionId` without delivering it.
   * Used when a subscription is torn down: late delivery after unsubscribe
   * would violate the lifecycle contract.
   */
  private cancelProgressBatch(subscriptionId: string): void {
    const batch = this.progressBatches.get(subscriptionId);
    if (!batch) return;
    clearTimeout(batch.timer);
    this.progressBatches.delete(subscriptionId);
  }

  /**
   * Returns true iff at least one subscription for `jobId` has 'progress'
   * in its `on` set. The presence of a progress subscriber is the demand
   * signal that keeps the per-job progress timer armed (PRI-1707).
   */
  private hasProgressSubscriber(jobId: string): boolean {
    const subIds = this.subscriptionsByJob.get(jobId);
    if (!subIds) return false;
    for (const subId of subIds) {
      const sub = this.subscriptions.get(subId);
      if (sub?.on.includes('progress')) return true;
    }
    return false;
  }

  /**
   * Arm the progress timer for `jobId` if it isn't already running.
   *
   * - No-op when the job isn't in the running-jobs map.
   * - No-op when the job's status is no longer 'running' — arming a fresh
   *   interval on a finished job would zombie until the first tick
   *   self-clears it inside createSetupProgressTimer (5min default), wasting
   *   the full window for nothing.
   * - No-op when the dep is missing (some test rigs omit it).
   * - Idempotent: a second call while the timer is armed does nothing.
   */
  private startProgressTimerIfNeeded(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    if (job.status !== 'running') return;
    if (job.progressTimer) return;
    this.deps.setupProgressTimer?.(job);
  }

  /**
   * Stop the progress timer for `jobId` IF (a) the operator did not
   * explicitly configure an interval at create time, AND (b) no
   * progress-watching subscriber remains. Operator-configured cadences
   * survive subscriber churn — the operator's intent is independent of
   * who's listening.
   */
  private stopProgressTimerIfUnused(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    if (job.progressIntervalMs !== undefined) return;
    if (this.hasProgressSubscriber(jobId)) return;
    this.stopProgressTimer(job);
  }

  /**
   * Clear the in-flight progress interval handle on `job`, if any.
   * Unconditional — callers decide when stopping is appropriate.
   */
  private stopProgressTimer(job: JobState): void {
    if (job.progressTimer) {
      clearInterval(job.progressTimer);
      job.progressTimer = undefined;
    }
  }

  /**
   * Remove every subscription registered for `jobId`. Called when the job
   * itself is removed from the JobManager so the subscription registry
   * can't grow without bound across a long-lived session.
   */
  private clearSubscriptionsForJob(jobId: string): void {
    const subIds = this.subscriptionsByJob.get(jobId);
    if (!subIds) return;
    for (const subId of subIds) {
      // Job-end reap (cancel/kill/session-close): the buffered progress
      // represents the most recent meaningful tail — flush it so the agent
      // doesn't lose 0–200ms of work to teardown. Contrast with
      // unsubscribe(), which is explicit user intent to STOP receiving and
      // therefore cancels (drops) the pending batch.
      this.flushProgressBatch(subId);
      this.subscriptions.delete(subId);
    }
    this.subscriptionsByJob.delete(jobId);
  }

  /**
   * Find a subscription whose args match exactly (jobId, on as a set, filter).
   */
  private findSubscription(opts: SubscribeOptions): JobSubscription | undefined {
    const subIds = this.subscriptionsByJob.get(opts.jobId);
    if (!subIds) return undefined;
    const wantOn = [...opts.on].sort().join(',');
    for (const subId of subIds) {
      const existing = this.subscriptions.get(subId);
      if (!existing) continue;
      const haveOn = [...existing.on].sort().join(',');
      if (haveOn !== wantOn) continue;
      if ((existing.filter ?? null) !== (opts.filter ?? null)) continue;
      return existing;
    }
    return undefined;
  }

  /**
   * Create a new job (shell or delegate) and start it.
   * Returns the job ID immediately; the job runs asynchronously.
   */
  async createJob(
    type: 'shell' | 'delegate',
    options: CreateJobOptions
  ): Promise<{ jobId: string; job: JobState }> {
    // Validate mutual exclusion of preallocated vs resume session ids
    if (options.newSubagentSessionId && options.resumeSessionId) {
      throw new JobCreationError(
        'newSubagentSessionId and resumeSessionId are mutually exclusive — only one may be set',
        -32602,
        'params'
      );
    }

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

    const containerExecutionContext =
      type === 'delegate'
        ? buildContainerExecutionContext({
            identity: options.containerExecutionIdentity,
            jobId,
            persona: options.persona,
            parentSessionId: activeSession.sessionId,
            runtimeBinding: options.runtimeBinding,
            containerSpecName: options.containerSpecName,
          })
        : undefined;

    // PRI-1867 M4: ask the embedder for per-spawn env additions (e.g. sen-core's
    // placeholder tokens for sen-credential-proxy). Only applies to delegate
    // jobs that actually got a containerExecutionContext (i.e. containerized
    // spawn with an identity config). Failure of the host RPC is non-fatal —
    // the spawn proceeds with the base executionEnv.
    let finalExecutionEnv = containerExecutionContext?.executionEnv;
    if (
      type === 'delegate' &&
      containerExecutionContext &&
      options.persona &&
      this.deps.fetchEmbedderSpawnEnv
    ) {
      try {
        const embedderEnv = await this.deps.fetchEmbedderSpawnEnv({
          jobId,
          persona: options.persona,
          parentSessionId: activeSession.sessionId,
          ...(options.runtimeBinding?.identity.runtimeId
            ? { runtimeId: options.runtimeBinding.identity.runtimeId }
            : {}),
        });
        if (embedderEnv && typeof embedderEnv === 'object' && !Array.isArray(embedderEnv)) {
          finalExecutionEnv = mergeEmbedderSpawnEnv(
            containerExecutionContext.executionEnv,
            embedderEnv,
            jobId
          );
        } else {
          logger.warn('host_spawn_env.malformed_response_ignored', {
            jobId,
            actualType: Array.isArray(embedderEnv) ? 'array' : typeof embedderEnv,
          });
        }
      } catch (err) {
        // Embedder method missing or RPC error — log and proceed with base env.
        logger.warn('host_spawn_env.request_failed', {
          jobId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

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
      ...(options.runtimeBinding ? { runtimeBinding: options.runtimeBinding } : {}),
      ...(containerExecutionContext
        ? {
            executionEnv: finalExecutionEnv ?? containerExecutionContext.executionEnv,
            containerExecutionMetadata: containerExecutionContext.metadata,
          }
        : {}),
      ...(options.scratchDirHostPath ? { scratchDirHostPath: options.scratchDirHostPath } : {}),
      ...(options.containerSharing ? { containerSharing: options.containerSharing } : {}),
      ...(options.containerSpecName ? { containerSpecName: options.containerSpecName } : {}),
      ...(type === 'delegate'
        ? {
            subagentContent: [{ type: 'text', text: options.prompt }],
            ...(options.resumeSessionId ? { subagentSessionId: options.resumeSessionId } : {}),
            ...(options.newSubagentSessionId
              ? {
                  subagentSessionId: options.newSubagentSessionId,
                  subagentSessionPreallocated: true,
                }
              : {}),
            ...(options.persona ? { persona: options.persona } : {}),
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
        ...(options.runtimeBinding ? { runtimeBinding: options.runtimeBinding } : {}),
        ...(options.scratchDirHostPath ? { scratchDirHostPath: options.scratchDirHostPath } : {}),
        ...(options.containerSharing ? { containerSharing: options.containerSharing } : {}),
        ...(options.containerSpecName ? { containerSpecName: options.containerSpecName } : {}),
        ...(containerExecutionContext
          ? { containerExecutionMetadata: containerExecutionContext.metadata }
          : {}),
      },
    });

    // 6. Emit job_started update
    await this.deps.emitUpdate({
      type: 'job_started',
      jobId,
      parentJobId: options.parentJobId,
      jobType,
      description,
      ...(containerExecutionContext
        ? { containerExecutionMetadata: containerExecutionContext.metadata }
        : {}),
    });

    // 7. Set up progress timer ONLY when the operator explicitly opted in
    // via `progressIntervalMs` (PRI-1707). Otherwise the timer stays
    // dormant until a subscriber registers with `on` containing 'progress'.
    if (options.progressIntervalMs !== undefined) {
      this.deps.setupProgressTimer?.(job);
    }

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
