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
    run_async: z.boolean().default(false),
    resume: z.string().optional(),
  })
  .strict();

export class DelegateTool extends Tool {
  name = 'delegate';
  description =
    'Spawn a background subagent job and return its report (streamed job updates are available via ent/job/*).';
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
