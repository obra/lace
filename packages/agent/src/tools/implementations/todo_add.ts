// ABOUTME: Todo list add tool schema stub
// ABOUTME: Executed by lace-agent runtime (not via ToolExecutor)

import { z } from 'zod';
import { Tool } from '../tool';
import { NonEmptyString } from '../schemas/common';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';

const todoAddSchema = z
  .object({
    title: NonEmptyString.describe('Brief, clear task description (one sentence)'),
    description: z
      .string()
      .optional()
      .describe('Longer prose with details, context, or a full prompt'),
  })
  .strict();

export class TodoAddTool extends Tool {
  name = 'todo_add';
  description = `Add a task to YOUR internal task list for tracking YOUR work in this session.

IMPORTANT: This is for tracking work YOU are doing, not for building todo apps for users.
If the user asks you to "build a todo app" or "create a task manager", that's a coding
request - don't use this tool for that.

Use this when:
- Breaking down a multi-step coding task you're about to do
- Planning implementation work the user requested
- Tracking progress on complex changes

Parameters:
- title: Action-oriented task name, 3-10 words (e.g., "Implement user login endpoint")
- description: Optional details, acceptance criteria, or notes

Good titles: "Fix null pointer in parser", "Add validation to signup form"
Bad titles: "Work on stuff", "The thing we discussed", "TODO"

Returns JSON: { id: "t_xxx" } - Save this ID to mark the task done later.`;
  schema = todoAddSchema;
  annotations: ToolAnnotations = {
    title: 'Add Todo Item',
    safeInternal: true,
  };

  protected executeValidated(
    _args: z.infer<typeof todoAddSchema>,
    _context: ToolContext
  ): Promise<ToolResult> {
    return Promise.resolve({
      status: 'failed',
      content: [
        {
          type: 'text',
          text: 'todo_add is executed by the lace-agent runtime (should not be executed via ToolExecutor).',
        },
      ],
    });
  }
}
