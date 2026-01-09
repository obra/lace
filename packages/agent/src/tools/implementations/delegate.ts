// ABOUTME: Delegate tool schema stub for subagent execution
// ABOUTME: Executed by lace-agent runtime (not via ToolExecutor)

import { z } from 'zod';
import { Tool } from '../tool';
import { NonEmptyString } from '../schemas/common';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';

const delegateSchema = z
  .object({
    prompt: NonEmptyString,
    description: z.string().optional(),
    background: z.boolean().default(false),
    resume: z.string().optional(),
  })
  .strict();

export class DelegateTool extends Tool {
  name = 'delegate';
  description = `Spawn a subagent to handle a task autonomously.

Parameters:
- prompt: The task for the subagent (required)
- description: Label shown in job listings (optional)
- background: Set to true to return immediately with jobId (default: false)
- resume: JobId of a failed/cancelled job to continue from where it left off

When background=true, returns { jobId, status: "started" }. Use job_output(jobId) to monitor.
Default (sync): Blocks until subagent completes and returns full output.`;
  schema = delegateSchema;
  annotations: ToolAnnotations = {
    title: 'Delegate',
    destructiveHint: true,
    openWorldHint: true,
    readOnlySafe: false,
  };

  protected executeValidated(
    _args: z.infer<typeof delegateSchema>,
    _context: ToolContext
  ): Promise<ToolResult> {
    return Promise.resolve({
      status: 'failed',
      content: [
        {
          type: 'text',
          text: 'delegate is executed by the lace-agent runtime (should not be executed via ToolExecutor).',
        },
      ],
    });
  }
}
