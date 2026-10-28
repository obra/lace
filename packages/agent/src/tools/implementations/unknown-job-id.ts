// ABOUTME: The refusal the job tools give for a jobId no job has had. It names the session's
// ABOUTME: most recent real jobs so an agent that retyped an id from memory can pick the one it meant.
// ABOUTME: Also used by todo_write (PRI-3362) to catch a job id composed into free text before the
// ABOUTME: delegate/bash(background=true) call that creates it has returned.

import type { JobManager, JobRecord } from '../../jobs/job-manager';

const RECENT_JOBS_SHOWN = 5;

export function unknownJobIdMessage(jobId: string, jobs: readonly JobRecord[]): string {
  const head =
    `No job with id ${JSON.stringify(jobId)}. Copy job ids from a tool result ` +
    '(`delegate`, `bash(background=true)`, `jobs_list`), never from memory.';
  if (jobs.length === 0) return `${head} This session has no jobs yet.`;
  const recent = [...jobs]
    .sort((a, b) => b.startTime.localeCompare(a.startTime))
    .slice(0, RECENT_JOBS_SHOWN)
    .map((j) => {
      const description = j.description !== undefined ? `, ${JSON.stringify(j.description)}` : '';
      return `- ${j.jobId} (${j.status}, started ${j.startTime}${description})`;
    });
  return `${head} Most recent jobs in this session:\n${recent.join('\n')}`;
}

// Matches a job id's exact shape: `job_` followed by a randomUUID() (36 hex/dash
// chars). Deliberately narrow — only the job-id namespace is guarded here, not
// every UUID-shaped token a tool's free text might legitimately contain.
const JOB_ID_TOKEN = /job_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Every job_<uuid> token in `text`, deduplicated, in order of first appearance.
 */
export function citedJobIds(text: string): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const match of text.matchAll(JOB_ID_TOKEN)) {
    const id = match[0];
    if (!seen.has(id)) {
      seen.add(id);
      ordered.push(id);
    }
  }
  return ordered;
}

/**
 * Cited job ids that this session's JobManager has never returned, live or
 * historical. listJobs() rebuilds from events.jsonl, so a job started before a
 * compaction or a process restart is still "known" here — only an id this
 * session genuinely never minted comes back.
 */
export function uncitedJobIds(
  text: string,
  jobManager: Pick<JobManager, 'getJob' | 'listJobs'>
): string[] {
  const cited = citedJobIds(text);
  if (cited.length === 0) return [];
  const known = new Set(jobManager.listJobs().map((j) => j.jobId));
  return cited.filter((id) => !jobManager.getJob(id) && !known.has(id));
}

/**
 * Refusal for a tool whose free-text input cites one or more job ids this
 * session has never returned. Lists every offending id — unlike
 * unknownJobIdMessage, which is for a single required jobId parameter.
 */
export function uncitedJobIdsMessage(toolName: string, unknownIds: readonly string[]): string {
  const plural = unknownIds.length > 1 ? 's' : '';
  const ids = unknownIds.map((id) => JSON.stringify(id)).join(', ');
  return (
    `${toolName} refused: cites job id${plural} ${ids}, which this session has never returned. ` +
    'Job ids must be copied from a tool result (`delegate`, `bash(background=true)`, `jobs_list`) — ' +
    'never typed from memory or guessed before the call that creates the job has returned. ' +
    'Call `jobs_list` if you are unsure which id you meant.'
  );
}
