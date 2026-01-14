// ABOUTME: Todo list write tool - creates new items or updates existing ones
// ABOUTME: Executed by lace-agent runtime (not via ToolExecutor)

import { z } from 'zod';
import { Tool } from '../tool';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';

const todoWriteSchema = z
  .object({
    id: z.string().optional().describe('Item ID - omit to create new item, provide to update'),
    title: z.string().optional().describe('Task title (required when creating new item)'),
    description: z.string().optional().describe('Optional details or notes'),
    status: z
      .enum(['pending', 'done', 'removed'])
      .optional()
      .describe("Status: 'pending' (default), 'done', or 'removed' (deletes item)"),
  })
  .strict();

export class TodoWriteTool extends Tool {
  name = 'todo_write';
  description = `Write to your internal tracking list - create new items or update existing ones.

This is YOUR private list. The user never sees it. Use it to track:
- Multi-step tasks you're working through
- Things to remember or come back to
- Anything you need to manage during this session

CREATE new item (no id):
  todo_write({ title: "Implement auth module" })
  Returns: { id: "t_xxx" }

UPDATE existing item (with id):
  todo_write({ id: "t_xxx", status: "done" })
  todo_write({ id: "t_xxx", status: "removed" })  // deletes it

Parameters:
- id: Item ID (omit to create, provide to update)
- title: Task description (required for new items)
- description: Optional details
- status: 'pending' | 'done' | 'removed' (default: pending)`;

  schema = todoWriteSchema;
  annotations: ToolAnnotations = {
    title: 'Write Todo Item',
    safeInternal: true,
  };

  protected executeValidated(
    _args: z.infer<typeof todoWriteSchema>,
    _context: ToolContext
  ): Promise<ToolResult> {
    return Promise.resolve({
      status: 'failed',
      content: [
        {
          type: 'text',
          text: 'todo_write is executed by the lace-agent runtime (should not be executed via ToolExecutor).',
        },
      ],
    });
  }
}
