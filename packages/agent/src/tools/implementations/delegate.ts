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
    progressIntervalMs: z.number().int().min(5000).max(600000).optional(),
    connectionId: z.string().optional(),
    modelId: z.string().optional(),
  })
  .strict();

export class DelegateTool extends Tool {
  name = 'delegate';
  description = `Spawn a subagent to handle a task autonomously.

Parameters:
- prompt: The task or message for the subagent (required)
- description: Label shown in job listings (optional)
- background: Set to true to return immediately with jobId (default: false)
- resume: JobId of a previous job to continue its session
- progressIntervalMs: For background jobs, interval in ms for progress notifications (5000-600000, default 300000)
- connectionId: Provider connection to use for the subagent (optional, defaults to parent session's connection)
- modelId: Model to use for the subagent (optional, defaults to parent session's model)

**Sync mode (default):** Blocks until subagent completes and returns full output.

**Background mode:** Returns { jobId, status: "started" } immediately. Use job_output(jobId) to check status. You receive a notification upon completion.

**Conversing with subagents:**
If a subagent asks a question or you want to continue working with it, use the resume parameter:
  delegate(resume="<jobId>", prompt="your response")
The subagent's session is preserved - it sees your message as a continuation of the conversation.`;
  schema = delegateSchema;
  annotations: ToolAnnotations = {
    title: 'Delegate',
    // Delegation itself is safe internal control flow - the subagent
    // handles its own permissions for any destructive operations
    safeInternal: true,
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
