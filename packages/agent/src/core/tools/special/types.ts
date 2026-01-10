// ABOUTME: Types for special tool handlers that bypass normal tool execution
// These tools (delegate, job_output, jobs_list, job_kill) need access to runtime state

import type { ChildProcess } from 'node:child_process';

/**
 * Job state tracked at runtime
 */
export interface JobState {
  jobId: string;
  type: 'shell' | 'delegate';
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  description?: string;
  command?: string;
  startTime?: string;
  exitCode?: number;
  subagentSessionId?: string;
  proc?: ChildProcess;
  completion: Promise<void>;
}

/**
 * Job record for listing/querying
 */
export interface JobRecord {
  jobId: string;
  parentJobId?: string;
  type: string;
  status: string;
  description?: string;
  command?: string;
  startTime?: string;
  exitCode?: number;
  subagentSessionId?: string;
}

/**
 * Context needed by special tool handlers
 */
export interface SpecialToolContext {
  sessionDir: string;
  turnId: string;
  turnSeq: number;
  abortSignal: AbortSignal;
  /** Get map of currently running jobs */
  getJobs: () => Map<string, JobState>;
  /** Get derived list of all jobs (running + persisted) */
  deriveJobs: () => JobRecord[];
  /** Start a shell job */
  startShellJob: (options: StartShellJobOptions) => Promise<{ jobId: string }>;
  /** Start a subagent (delegate) job */
  startSubagentJob: (options: StartSubagentJobOptions) => Promise<{ jobId: string }>;
  /** Finalize a completed job */
  finalizeJob: (job: JobState) => Promise<void>;
}

export interface StartShellJobOptions {
  command: string;
  description?: string;
  turnContext: { turnId: string; turnSeq: number };
}

export interface StartSubagentJobOptions {
  prompt: string;
  description?: string;
  turnContext: { turnId: string; turnSeq: number };
  resumeSessionId?: string;
  connectionId?: string;
  modelId?: string;
}

/**
 * Result from executing a special tool
 */
export interface SpecialToolResult {
  status: 'completed' | 'failed' | 'aborted';
  content: Array<{ type: 'text'; text: string }>;
}
