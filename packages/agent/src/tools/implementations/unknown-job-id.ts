// ABOUTME: The refusal the job tools give for a jobId no job has had. It names the session's
// ABOUTME: most recent real jobs so an agent that retyped an id from memory can pick the one it meant.

import type { JobRecord } from '../../jobs/job-manager';

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
