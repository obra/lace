// ABOUTME: Todo list remove tool schema stub
// ABOUTME: Executed by lace-agent runtime (not via ToolExecutor)

import { z } from 'zod';
import { Tool } from '../tool';
import { NonEmptyString } from '../schemas/common';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';

const todoRemoveSchema = z
  .object({
    id: NonEmptyString.describe('The unique ID of the item to remove'),
  })
  .strict();

export class TodoRemoveTool extends Tool {
  name = 'todo_remove';
  description = `Remove a task from your list entirely.

Use sparingly - usually you should mark tasks done rather than removing them.
Remove when: task was added by mistake, task is no longer relevant, cleaning up.

Parameters:
- id: The task's unique ID like "t_a1b" (required - get from todo_read)

Note: Completed tasks can stay in the list as a record. Only remove if the task
should never have existed or is cluttering your list.`;
  schema = todoRemoveSchema;
  annotations: ToolAnnotations = {
    title: 'Remove Todo Item',
    safeInternal: true,
  };

  protected executeValidated(
    _args: z.infer<typeof todoRemoveSchema>,
    _context: ToolContext
  ): Promise<ToolResult> {
    return Promise.resolve({
      status: 'failed',
      content: [
        {
          type: 'text',
          text: 'todo_remove is executed by the lace-agent runtime (should not be executed via ToolExecutor).',
        },
      ],
    });
  }
}
