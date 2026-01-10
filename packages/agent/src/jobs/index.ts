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

// Job notifications
export {
  createQueueJobNotification,
  createSetupProgressTimer,
  createFinalizeJob,
} from './job-notifications';

// Notification formatting
export { formatJobNotification } from './format-notification';
