// ABOUTME: Todo list read tool schema stub
// ABOUTME: Executed by lace-agent runtime (not via ToolExecutor)

import { z } from 'zod';
import { Tool } from '../tool';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';

const todoReadSchema = z.object({}).strict();

export class TodoReadTool extends Tool {
  name = 'todo_read';
  description = `Read your internal tracking list to see current items and their status.

This is YOUR private list - the user never sees it.
Use it to check progress, find item IDs for updates, or review what's tracked.

Returns JSON: { items: [{ id, status, title, description? }, ...] }

Example response:
{
  "items": [
    { "id": "t_a1b", "status": "pending", "title": "Implement auth module" },
    { "id": "t_c2d", "status": "done", "title": "Write database schema" }
  ]
}`;
  schema = todoReadSchema;
  annotations: ToolAnnotations = {
    title: 'Read Todo List',
    safeInternal: true,
    readOnlySafe: true,
  };

  protected executeValidated(
    _args: z.infer<typeof todoReadSchema>,
    _context: ToolContext
  ): Promise<ToolResult> {
    return Promise.resolve({
      status: 'failed',
      content: [
        {
          type: 'text',
          text: 'todo_read is executed by the lace-agent runtime (should not be executed via ToolExecutor).',
        },
      ],
    });
  }
}
