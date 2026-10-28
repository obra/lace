// ABOUTME: Job output retrieval tool using JobManager
// Uses JobManager from ToolContext for all job operations

import { z } from 'zod';
import { Tool } from '../tool';
import { NonEmptyString } from '../schemas/common';
import { DEFAULT_STALL_THRESHOLD_MS } from '../../server-types';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';
import { unknownJobIdMessage } from './unknown-job-id';
import { sliceText, describeSlice, type SliceOpts } from '@lace/agent/storage/tool-result-store';

const jobOutputSchema = z
  .object({
    jobId: NonEmptyString,
    byteOffset: z.number().int().min(0).default(0),
    head_lines: z.number().int().min(0).optional(),
    tail_lines: z.number().int().min(0).optional(),
    grep: z.string().optional(),
    grep_context_chars: z.number().int().min(0).optional(),
    head_bytes: z.number().int().min(0).optional(),
    tail_bytes: z.number().int().min(0).optional(),
  })
  .strict();

export class JobOutputTool extends Tool {
  name = 'job_output';
  description = `Read a **snapshot** of status + stdout from a background job. **Read-only tool** — returns immediately and does NOT continue the conversation or wait for the job to finish.

**Mental model.** A job is one round; a session is the whole conversation. \`job_output\` shows what has come out of *this round* so far. To continue the conversation (add a follow-up message to the same subagent), call \`delegate(resume=jobId, prompt=...)\` — that creates a new job in the same session.

**To know when a job is done, use \`job_notify(jobId)\`, not polling.** \`job_output\` never blocks: if the job is still running you get the current partial output and \`status:"running"\`. Do NOT loop calling \`job_output\` to wait for completion. Instead call \`job_notify(jobId)\` (subscribe and return to the user); you'll be woken on a later turn when the job finishes.

Parameters:
- \`jobId\` (required): the job to inspect.
- \`byteOffset\` (default 0): reserved for future incremental reads.
- \`grep\` (preferred for large outputs): return only lines of the job's output containing this substring. For line-oriented output (logs, bash) whole matching lines come back. For output that's one giant line (e.g. a single-line JSON blob), grep auto-windows: it returns only a bounded slice (±\`grep_context_chars\`, default 200) around each match, joined with \`…\`, so you isolate the needle instead of the whole blob.
- \`grep_context_chars\`: half-width (chars) of the window kept around each match when a long single line is windowed.
- \`head_bytes\` / \`tail_bytes\`: return the first / last N raw bytes of the job's output (UTF-8-safe). Use for explicit paging regardless of line structure.
- \`head_lines\` / \`tail_lines\`: return the first / last N lines of the job's output.

With none of \`grep\`/\`head_bytes\`/\`tail_bytes\`/\`head_lines\`/\`tail_lines\` given, \`output\` is the job's full output, same as always. Giving any of them slices the output before returning and prefixes it with a header reporting the full output's total bytes/lines and what slice you got — same semantics and header style as \`read_tool_result\`. Use this instead of a follow-up \`read_tool_result\` call: that tool pages a digest's sidecar by a \`tool_call_id\` that only appears in the digest text, so you can't call it in the same batch as the \`job_output\` call that produces it.

Output remains readable after a job ends, including a job that was killed mid-flight — a partial result is still a result. \`No job with id\` means no job in this session has ever had that id; the refusal lists the most recent real ones.

Returns: \`{ status: "running"|"completed"|"failed"|"cancelled", output: string, exitCode?: number, stalled?: true, stalledForMs?: number }\`. \`stalled: true\` means the job is still running but its output has not grown for the stall threshold (~15 min) — it may be wedged; you will also receive a one-shot \`job-stalled\` notification when this happens.`;
  schema = jobOutputSchema;
  annotations: ToolAnnotations = {
    title: 'Get Job Output',
    // Internal job management - queries job state without side effects
    safeInternal: true,
    readOnlySafe: true,
  };

  protected async executeValidated(
    args: z.infer<typeof jobOutputSchema>,
    context: ToolContext
  ): Promise<ToolResult> {
    const { jobManager } = context;

    if (!jobManager) {
      return {
        status: 'failed',
        content: [{ type: 'text', text: 'job_output requires jobManager in context' }],
      };
    }

    const { jobId, head_lines, tail_lines, grep, grep_context_chars, head_bytes, tail_bytes } =
      args;

    // A finished job is deleted from the live map, but its output file and its
    // job_finished event both survive. Resolving from the map alone reports
    // "not found" for a job whose output is sitting on disk — which makes a
    // completed or killed job look like one that never ran. Fall back to the
    // event-derived record so the output stays readable after the job ends.
    const job = jobManager.getJob(jobId) ?? jobManager.listJobs().find((j) => j.jobId === jobId);
    if (!job) {
      return {
        status: 'failed',
        content: [{ type: 'text', text: unknownJobIdMessage(jobId, jobManager.listJobs()) }],
      };
    }

    const output = jobManager.getJobOutput(jobId);

    // Stall flag: a live running job whose output file has not grown for the
    // stall threshold. Only live-map jobs carry lastOutputChangeAt (the
    // event-derived fallback record is for finished jobs, which can't stall).
    const lastOutputChangeAt = (job as { lastOutputChangeAt?: number }).lastOutputChangeAt;
    const stalledForMs =
      job.status === 'running' && typeof lastOutputChangeAt === 'number'
        ? Date.now() - lastOutputChangeAt
        : 0;
    const stalled = stalledForMs >= DEFAULT_STALL_THRESHOLD_MS;

    const trimmedOutput = output.trim();
    const sliceOpts: SliceOpts = {
      headLines: head_lines,
      tailLines: tail_lines,
      grep,
      grepContextChars: grep_context_chars,
      headBytes: head_bytes,
      tailBytes: tail_bytes,
    };
    const hasSliceParams =
      head_lines !== undefined ||
      tail_lines !== undefined ||
      grep !== undefined ||
      grep_context_chars !== undefined ||
      head_bytes !== undefined ||
      tail_bytes !== undefined;

    // With no slicing params, behavior is unchanged: the job's full (trimmed)
    // output, or the "(no output)" sentinel. With any given, slice the full
    // output the same way read_tool_result slices a spilled sidecar, and
    // prefix a matching header — so a large result can be paged in this same
    // call, with no second read_tool_result(tool_call_id=...) to guess at.
    let outputForResult: string;
    if (trimmedOutput === '') {
      outputForResult = '(no output)';
    } else if (hasSliceParams) {
      const slice = sliceText(trimmedOutput, sliceOpts);
      const sliceDesc = describeSlice(sliceOpts, slice);
      const header = `[job ${jobId} output — ${slice.lineCount} lines, ${slice.totalBytes} bytes total — returning ${sliceDesc}]`;
      outputForResult = `${header}\n${slice.content}`;
    } else {
      outputForResult = trimmedOutput;
    }

    const result = {
      jobId,
      status: job.status,
      output: outputForResult,
      ...(typeof job.exitCode === 'number' ? { exitCode: job.exitCode } : {}),
      ...(stalled ? { stalled: true, stalledForMs } : {}),
    };

    return {
      status: 'completed',
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
}
