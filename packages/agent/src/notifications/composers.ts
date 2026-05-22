// ABOUTME: Pure body-composer functions for each notification kind. No side effects.
// ABOUTME: Output strings are wrapped by buildNotification in inject-notification.ts.

import { formatAbsoluteTime } from './format-time';

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

export type AlarmFiredCompose =
  | {
      kind: 'once-absolute';
      scheduledFor: number;
      timezone: string;
      prompt: string;
      alarmId: string;
    }
  | { kind: 'once-relative'; minutes: number; prompt: string; alarmId: string }
  | { kind: 'cron'; expr: string; timezone: string; prompt: string; alarmId: string }
  | { kind: 'interval'; minutes: number; prompt: string; alarmId: string };

export function composeAlarmFiredBody(a: AlarmFiredCompose): string {
  switch (a.kind) {
    case 'once-absolute': {
      const when = formatAbsoluteTime(a.scheduledFor, a.timezone);
      return `Your alarm for ${when} just fired. Note: "${a.prompt}".`;
    }
    case 'once-relative':
      return `Your ${a.minutes}-minute timer just fired. Note: "${a.prompt}".`;
    case 'cron':
      return `Your cron alarm ${a.alarmId} (${a.expr} in ${a.timezone}) just fired. Note: "${a.prompt}".`;
    case 'interval': {
      const unit = a.minutes === 1 ? 'minute' : 'minutes';
      return `Your interval alarm ${a.alarmId} (every ${a.minutes} ${unit}) just fired. Note: "${a.prompt}".`;
    }
  }
}

export type AlarmExpiredCompose =
  | {
      kind: 'cron';
      expr: string;
      timezone: string;
      endTime: number;
      endTimezone: string;
      prompt: string;
      alarmId: string;
    }
  | {
      kind: 'interval';
      minutes: number;
      endTime: number;
      endTimezone: string;
      prompt: string;
      alarmId: string;
    };

export function composeAlarmExpiredBody(a: AlarmExpiredCompose): string {
  const endStr = formatAbsoluteTime(a.endTime, a.endTimezone);
  switch (a.kind) {
    case 'cron':
      return `Your cron alarm ${a.alarmId} (${a.expr} in ${a.timezone}) reached its end time (${endStr}) and won't fire again. Last note: "${a.prompt}".`;
    case 'interval': {
      const unit = a.minutes === 1 ? 'minute' : 'minutes';
      return `Your interval alarm ${a.alarmId} (every ${a.minutes} ${unit}) reached its end time (${endStr}) and won't fire again. Last note: "${a.prompt}".`;
    }
  }
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

export interface SubagentPendingAlarm {
  id: string;
  kind: 'cron' | 'once' | 'interval';
  schedule: string; // human description of what this alarm was (cron expr, ISO, "every N min", "in N min")
  prompt: string;
  end_at_iso?: string; // formatted absolute time string for bounded recurring alarms
}

export interface SubagentExitedCompose {
  persona: string;
  pendingAlarms: SubagentPendingAlarm[];
}

export function composeSubagentExitedBody(s: SubagentExitedCompose): string {
  const personaWord = s.persona.length > 0 ? `${s.persona} ` : '';
  const n = s.pendingAlarms.length;
  const head = `Your ${personaWord}subagent exited gracefully but had ${n} pending alarm${n === 1 ? '' : 's'} that won't fire now`;
  if (n === 1) {
    const a = s.pendingAlarms[0];
    return `${head}: ${formatPendingAlarm(a)}`;
  }
  const lines = s.pendingAlarms.map((a) => `  ${formatPendingAlarm(a)}`).join('\n');
  return `${head}:\n${lines}`;
}

function formatPendingAlarm(a: SubagentPendingAlarm): string {
  let desc: string;
  switch (a.kind) {
    case 'cron':
      desc = `was a cron (${a.schedule})`;
      break;
    case 'interval':
      desc = `was an interval alarm (${a.schedule})`;
      break;
    case 'once':
      desc = `was a one-shot scheduled for ${a.schedule}`;
      break;
  }
  const expiryClause = a.end_at_iso !== undefined ? ` (expiring at ${a.end_at_iso})` : '';
  return `${a.id} ${desc} with the prompt "${a.prompt}"${expiryClause}.`;
}
