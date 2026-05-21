// ABOUTME: Job creation functions for shell and subagent jobs.
// These functions handle creating JobState, persisting job_started events,
// and kicking off job execution. Designed for use via library API or RPC.

import { randomUUID } from 'node:crypto';
import type { JobState, JobType, SessionUpdate } from '../server-types';
import { MAX_CONCURRENT_JOBS } from '../server-types';
import { getJobOutputPath } from './job-file-utils';
import type { LoadedSession } from '../storage/session-store';

/**
 * Options for creating a shell job.
 */
export type CreateShellJobOptions = {
  command: string;
  description?: string;
  parentJobId?: string;
  turnContext?: { turnId: string; turnSeq: number };
  progressIntervalMs?: number;
};

/**
 * Options for creating a subagent job.
 */
export type CreateSubagentJobOptions = {
  prompt: string;
  description?: string;
  parentJobId?: string;
  turnContext?: { turnId: string; turnSeq: number };
  resumeSessionId?: string;
  progressIntervalMs?: number;
  connectionId?: string;
  modelId?: string;
};

/**
 * Dependencies for job creation - allows use without RPC.
 */
export type JobCreationDeps = {
  /** Get the active session, or null if none. */
  getActiveSession: () => LoadedSession | null;
  /** Get the jobs map for tracking running jobs. */
  getJobs: () => Map<string, JobState>;
  /** Persist a job_started event to the session. */
  persistJobStartedEvent: (event: {
    jobId: string;
    parentJobId?: string;
    jobType: JobType;
    description?: string;
    command?: string;
    turnContext?: { turnId: string; turnSeq: number };
  }) => Promise<void>;
  /** Emit a session update notification. */
  emitSessionUpdate: (
    update: SessionUpdate,
    context?: { turnId?: string; turnSeq?: number }
  ) => Promise<void>;
  /** Set up progress timer for the job. */
  setupProgressTimer: (job: JobState) => void;
  /** Start the shell job process. */
  runShellJobProcess: (job: JobState) => void;
  /** Start the subagent job process. */
  runSubagentJobProcess: (job: JobState) => void;
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
 * Common job scaffolding - validates session, checks limits, generates ID,
 * creates completion promise. Used by both shell and subagent job creation.
 */
function scaffoldJob(
  deps: JobCreationDeps,
  _options: { parentJobId?: string; turnContext?: { turnId: string; turnSeq: number } }
): {
  activeSession: LoadedSession;
  jobId: string;
  startedAt: string;
  outputPath: string;
  completion: Promise<void>;
  resolveCompletion: () => void;
} {
  const activeSession = deps.getActiveSession();
  if (!activeSession) {
    throw new JobCreationError('No active session', -32001, 'session');
  }

  const jobs = deps.getJobs();
  const runningJobCount = [...jobs.values()].filter((j) => j.status === 'running').length;
  if (runningJobCount >= MAX_CONCURRENT_JOBS) {
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

  return { activeSession, jobId, startedAt, outputPath, completion, resolveCompletion };
}

/**
 * Persist and emit job_started event, then start the job process.
 */
async function finalizeJobCreation(
  deps: JobCreationDeps,
  job: JobState,
  event: {
    jobId: string;
    parentJobId?: string;
    jobType: JobType;
    description?: string;
    command?: string;
    turnContext?: { turnId: string; turnSeq: number };
  },
  runJobProcess: (job: JobState) => void
): Promise<{ jobId: string }> {
  deps.getJobs().set(job.jobId, job);

  await deps.persistJobStartedEvent(event);

  await deps.emitSessionUpdate(
    {
      type: 'job_started',
      jobId: event.jobId,
      parentJobId: event.parentJobId,
      jobType: event.jobType,
      description: event.description,
    },
    event.turnContext
      ? { turnId: event.turnContext.turnId, turnSeq: event.turnContext.turnSeq }
      : undefined
  );

  // Progress timer is opt-in (PRI-1707): arm only when the caller passed
  // an explicit progressIntervalMs. Subscriber-driven arming is handled
  // inside JobManager.subscribe().
  if (job.progressIntervalMs !== undefined) {
    deps.setupProgressTimer(job);
  }
  runJobProcess(job);

  return { jobId: job.jobId };
}

/**
 * Create a shell job that runs a command in the background.
 * Returns the job ID immediately; the job runs asynchronously.
 */
export async function createShellJob(
  options: CreateShellJobOptions,
  deps: JobCreationDeps
): Promise<{ jobId: string }> {
  const scaffold = scaffoldJob(deps, options);

  const job: JobState = {
    jobId: scaffold.jobId,
    parentJobId: options.parentJobId,
    type: 'bash',
    status: 'running',
    description: options.description,
    command: options.command,
    startedAt: scaffold.startedAt,
    originTurnId: options.turnContext?.turnId,
    originTurnSeq: options.turnContext?.turnSeq,
    outputPath: scaffold.outputPath,
    finished: false,
    completion: scaffold.completion,
    resolveCompletion: scaffold.resolveCompletion,
    progressIntervalMs: options.progressIntervalMs,
  };

  return finalizeJobCreation(
    deps,
    job,
    {
      jobId: scaffold.jobId,
      parentJobId: options.parentJobId,
      jobType: 'bash',
      description: options.description,
      command: options.command,
      turnContext: options.turnContext,
    },
    deps.runShellJobProcess
  );
}

/**
 * Create a subagent job that runs a conversation in the background.
 * Returns the job ID immediately; the job runs asynchronously.
 */
export async function createSubagentJob(
  options: CreateSubagentJobOptions,
  deps: JobCreationDeps
): Promise<{ jobId: string }> {
  const scaffold = scaffoldJob(deps, options);
  const description = options.description ?? 'Subagent';

  const job: JobState = {
    jobId: scaffold.jobId,
    parentJobId: options.parentJobId,
    type: 'delegate',
    status: 'running',
    description,
    command: options.prompt,
    subagentContent: [{ type: 'text', text: options.prompt }],
    startedAt: scaffold.startedAt,
    originTurnId: options.turnContext?.turnId,
    originTurnSeq: options.turnContext?.turnSeq,
    outputPath: scaffold.outputPath,
    finished: false,
    completion: scaffold.completion,
    resolveCompletion: scaffold.resolveCompletion,
    progressIntervalMs: options.progressIntervalMs,
    connectionId: options.connectionId,
    modelId: options.modelId,
    ...(options.resumeSessionId ? { subagentSessionId: options.resumeSessionId } : {}),
  };

  return finalizeJobCreation(
    deps,
    job,
    {
      jobId: scaffold.jobId,
      parentJobId: options.parentJobId,
      jobType: 'delegate',
      description,
      command: options.prompt,
      turnContext: options.turnContext,
    },
    deps.runSubagentJobProcess
  );
}
