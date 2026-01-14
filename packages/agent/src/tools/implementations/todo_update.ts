// ABOUTME: Todo list update tool schema stub
// ABOUTME: Executed by lace-agent runtime (not via ToolExecutor)

import { z } from 'zod';
import { Tool } from '../tool';
import { NonEmptyString } from '../schemas/common';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';

const todoUpdateSchema = z
  .object({
    id: NonEmptyString.describe('The unique ID of the item to update'),
    done: z.boolean().optional().describe('Set completion status'),
    title: z.string().optional().describe('Update the title'),
    description: z.string().optional().describe('Update the description'),
  })
  .strict();

export class TodoUpdateTool extends Tool {
  name = 'todo_update';
  description = `Update a task in your list - most commonly to mark it done.

IMPORTANT: You must provide the task's ID (from todo_read or todo_add response).

Common usage - mark task complete:
  todo_update({ id: "t_a1b", done: true })

Parameters:
- id: The task's unique ID like "t_a1b" (required - get from todo_read)
- done: true = completed, false = incomplete (optional)
- title: Replace the title text (optional, rarely needed)
- description: Replace the description (optional, rarely needed)

Only fields you provide are changed; others stay the same.`;
  schema = todoUpdateSchema;
  annotations: ToolAnnotations = {
    title: 'Update Todo Item',
    safeInternal: true,
  };

  protected executeValidated(
    _args: z.infer<typeof todoUpdateSchema>,
    _context: ToolContext
  ): Promise<ToolResult> {
    return Promise.resolve({
      status: 'failed',
      content: [
        {
          type: 'text',
          text: 'todo_update is executed by the lace-agent runtime (should not be executed via ToolExecutor).',
        },
      ],
    });
  }
}
