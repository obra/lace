import { z } from 'zod';
import { Tool } from '@lace/core/tools/tool';
import type { ToolContext, ToolResult } from '@lace/core/tools/types';

export class DelegateTool extends Tool {
  name = 'delegate';
  description =
    'Spawn a background subagent job and return its report (streamed job updates are available via ent/job/*).';
  schema = z
    .object({
      prompt: z.string().min(1),
    })
    .strict();

  protected async executeValidated(
    _args: ReturnType<this['schema']['parse']>,
    _context: ToolContext
  ): Promise<ToolResult> {
    return {
      status: 'failed',
      content: [
        {
          type: 'text',
          text: 'delegate is executed by the lace-agent runtime (should not be executed via ToolExecutor).',
        },
      ],
    };
  }
}
