// ABOUTME: Job output retrieval tool schema stub
// ABOUTME: Executed by lace-agent runtime (not via ToolExecutor)

import { z } from 'zod';
import { Tool } from '../tool';
import { NonEmptyString } from '../schemas/common';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';

const jobOutputSchema = z.object({
  jobId: NonEmptyString,
  block: z.boolean().default(true),
  timeoutMs: z.number().int().min(0).max(600_000).default(30_000),
  cursor: z.number().int().min(0).default(0),
});

export class JobOutputTool extends Tool {
  name = 'job_output';
  description = `Get status and output from a background job (started with background=true).

**Blocking (default):** Waits up to timeoutMs for job completion, then returns.
**Non-blocking:** Set block=false to check current status without waiting.
**Incremental:** Use cursor (byte offset) to read new output since last check.

Returns: { status: "running"|"completed"|"failed"|"cancelled", output: string, exitCode?: number }`;
  schema = jobOutputSchema;
  annotations: ToolAnnotations = {
    title: 'Get Job Output',
    destructiveHint: false,
    openWorldHint: false,
    readOnlySafe: true,
  };

  protected executeValidated(
    _args: z.infer<typeof jobOutputSchema>,
    _context: ToolContext
  ): Promise<ToolResult> {
    return Promise.resolve({
      status: 'failed',
      content: [
        {
          type: 'text',
          text: 'job_output is executed by the lace-agent runtime (should not be executed via ToolExecutor).',
        },
      ],
    });
  }
}
