// ABOUTME: Task manager tool exports for multi-agent task management
// ABOUTME: Provides SQLite-backed persistent task management with thread isolation

export { DatabasePersistence } from '~/persistence/database';
export {
  TaskCreateTool,
  TaskListTool,
  TaskCompleteTool,
  TaskUpdateTool,
  TaskAddNoteTool,
  TaskViewTool,
} from './tools';
export type { Task, TaskNote } from './types';

import { Tool } from '~/tools/tool';
import { TaskManager } from '~/tasks/task-manager';
import {
  TaskCreateTool,
  TaskListTool,
  TaskCompleteTool,
  TaskUpdateTool,
  TaskAddNoteTool,
  TaskViewTool,
} from '~/tools/implementations/task-manager/tools';

/**
 * Create task manager tools with injected TaskManager dependency
 * This ensures all task tools use the session-scoped TaskManager
 */
export function createTaskManagerTools(getTaskManager: () => TaskManager): Tool[] {
  const tools = [
    new TaskCreateTool(),
    new TaskListTool(),
    new TaskCompleteTool(),
    new TaskUpdateTool(),
    new TaskAddNoteTool(),
    new TaskViewTool(),
  ];

  // Inject TaskManager dependency into each tool
  tools.forEach((tool) => {
    // Use a type assertion with unknown to avoid TypeScript errors
    // The tools have protected getTaskManager property, but we need to set it
    const taskTool = tool as unknown as { getTaskManager?: () => TaskManager };
    taskTool.getTaskManager = getTaskManager;
  });

  return tools;
}
