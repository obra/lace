// ABOUTME: Todo list read tool schema stub
// ABOUTME: Executed by lace-agent runtime (not via ToolExecutor)

import { z } from 'zod';
import { Tool } from '../tool';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';

const todoReadSchema = z.object({}).strict();

export class TodoReadTool extends Tool {
  name = 'todo_read';
  description = `Read your current task list to see what work is pending or completed.

This is YOUR personal task list for tracking your own work during this session.
Use it to check progress, find task IDs for updates, or review what's left to do.

Returns JSON: { items: [{ id, done, title, description? }, ...] }

Example response:
{
  "items": [
    { "id": "t_a1b", "done": false, "title": "Implement auth module" },
    { "id": "t_c2d", "done": true, "title": "Write database schema" }
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
