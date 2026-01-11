// ABOUTME: Job subsystem exports for library API usage.
// Consolidates job creation, derivation, execution, and notification handling.

// Job creation - for starting shell and subagent jobs
export {
  createShellJob,
  createSubagentJob,
  JobCreationError,
  type CreateShellJobOptions,
  type CreateSubagentJobOptions,
  type JobCreationDeps,
} from './job-creation';

// Job derivation - for reconstructing job state from events
export { createJobDerivation, type DerivedJob } from './job-derivation';

// Job execution - process runners for shell and subagent jobs
export { createRunShellJobProcess, type ShellJobContext } from './shell-job';
export { runSubagentJobProcess } from './subagent-job';

// Job utilities
export { getJobOutputPath, ensureJobLogDir, getLastLines } from './job-manager';

// Job output reading
export {
  readJobOutput,
  readJobOutputTail,
  MAX_OUTPUT_SIZE,
  DEFAULT_TAIL_LIMIT,
  type JobOutputResult,
  type JobOutputTailResult,
  type ReadJobOutputOptions,
} from './job-output';

// Job notifications
export {
  createQueueJobNotification,
  createSetupProgressTimer,
  createFinalizeJob,
} from './job-notifications';

// Notification formatting
export { formatJobNotification } from './format-notification';

// Job control - killing and cancelling jobs
export { killJob, killAllRunningJobs, type KillJobOptions } from './job-control';
