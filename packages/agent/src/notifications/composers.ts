// ABOUTME: Pure body-composer functions for each notification kind. No side effects.
// ABOUTME: Output strings are wrapped by buildNotification in inject-notification.ts.

const MAX_LINE_LENGTH = 200;

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} seconds`;
  const mins = Math.floor(ms / 60_000);
  const secs = (ms % 60_000) / 1000;
  return `${mins}m ${secs.toFixed(1)}s`;
}

function formatBytes(bytes: number): string {
  return bytes.toLocaleString('en-US');
}

function truncate(line: string, maxLen = MAX_LINE_LENGTH): string {
  return line.length <= maxLen ? line : line.slice(0, maxLen - 3) + '...';
}

export interface JobCompletedCompose {
  jobId: string;
  jobType: 'bash' | 'delegate';
  exitCode: number;
  durationMs: number;
  outputBytes: number;
  lastLines: string[];
}

export function composeJobCompletedBody(j: JobCompletedCompose): string {
  const trailing = trailingLineHint(j.lastLines);
  const base = `Your background job completed successfully (exit code ${j.exitCode}) after ${formatDuration(j.durationMs)}, writing ${formatBytes(j.outputBytes)} bytes of output.${trailing} Call job_output(jobId="${j.jobId}") to read the full output.`;
  if (j.jobType === 'delegate') {
    return `${base} To continue this conversation thread, call delegate(resume="${j.jobId}", prompt="your message").`;
  }
  return base;
}

export type JobFailedCompose = JobCompletedCompose;

export function composeJobFailedBody(j: JobFailedCompose): string {
  const trailing = trailingLineHint(j.lastLines);
  const base = `Your background job failed (exit code ${j.exitCode}) after ${formatDuration(j.durationMs)}, writing ${formatBytes(j.outputBytes)} bytes of output.${trailing} Call job_output(jobId="${j.jobId}") to read the full output.`;
  if (j.jobType === 'delegate') {
    return `${base} To continue this conversation thread, call delegate(resume="${j.jobId}", prompt="your message").`;
  }
  return base;
}

export interface JobCancelledCompose {
  jobId: string;
  jobType: 'bash' | 'delegate';
  durationMs: number;
  outputBytes: number;
  lastLines: string[];
  reason?: string;
}

export function composeJobCancelledBody(j: JobCancelledCompose): string {
  const trailing = trailingLineHint(j.lastLines);
  const reasonText = j.reason ? ` Reason: ${j.reason}.` : '';
  return `Your background job was cancelled after ${formatDuration(j.durationMs)}, having written ${formatBytes(j.outputBytes)} bytes of output.${reasonText}${trailing} Call job_output(jobId="${j.jobId}") to read the full output.`;
}

export interface JobProgressCompose {
  jobId: string;
  durationMs: number;
  outputBytes: number;
  deltaBytes: number;
  lastLines: string[];
}

export function composeJobProgressBody(j: JobProgressCompose): string {
  const head = `Your background job has been running for ${formatDuration(j.durationMs)} and has written ${formatBytes(j.outputBytes)} bytes (+${formatBytes(j.deltaBytes)} since last update).`;
  if (j.lastLines.length === 0) {
    return `${head} Call job_output(jobId="${j.jobId}") to check current output.`;
  }
  const lines = j.lastLines.map((l) => `  ${truncate(l)}`).join('\n');
  return `${head} Recent output:\n${lines}\nCall job_output(jobId="${j.jobId}") to check current output.`;
}

function trailingLineHint(lines: string[]): string {
  if (lines.length === 0) return '';
  const last = truncate(lines[lines.length - 1]);
  return ` The last line was: "${last}".`;
}

// ---------- Reminders ----------

export interface ReminderBodyCompose {
  prompt: string;
}

export function composeReminderBody(c: ReminderBodyCompose): string {
  // Body is the prompt verbatim. The wrapper handles XML escaping.
  return c.prompt;
}

// ---------- Subagent exited (reminders variant) ----------

export interface SubagentPendingReminder {
  id: string;
  prompt: string;
  next_fire_at_iso: string;
}

export interface SubagentExitedReminderCompose {
  persona: string;
  pendingReminders: SubagentPendingReminder[];
}

const SUBAGENT_BUBBLE_INLINE_THRESHOLD = 5;
const SUBAGENT_BUBBLE_PROMPT_TRUNCATE = 200;

function truncateAtWordBoundary(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  const sliced = lastSpace > max - 30 ? cut.slice(0, lastSpace) : cut;
  return `${sliced}...`;
}

export function composeSubagentExitedBody(s: SubagentExitedReminderCompose): string {
  const personaWord = s.persona.length > 0 ? `${s.persona} ` : '';
  const n = s.pendingReminders.length;
  const head = `Your ${personaWord}subagent exited gracefully but had ${n} pending reminder${
    n === 1 ? '' : 's'
  } that won't fire now`;

  if (n === 0) return `${head}.`;

  if (n <= SUBAGENT_BUBBLE_INLINE_THRESHOLD) {
    const lines = s.pendingReminders
      .map((r) => `  ${r.id} (next fire ${r.next_fire_at_iso}): "${r.prompt}"`)
      .join('\n');
    return `${head}:\n${lines}`;
  }

  // Compact format: one line per reminder, line truncated to 200 chars at word boundary.
  const lines = s.pendingReminders
    .map((r) => {
      const prefix = `  ${r.id} [${r.next_fire_at_iso}]: `;
      const promptBudget = SUBAGENT_BUBBLE_PROMPT_TRUNCATE - prefix.length;
      const truncated = truncateAtWordBoundary(r.prompt, promptBudget);
      return `${prefix}${truncated}`;
    })
    .join('\n');
  return `${head}:\n${lines}`;
}
