// ABOUTME: Task manager tool exports for multi-agent task management
// ABOUTME: Provides SQLite-backed persistent task management with thread isolation

export { TaskPersistence } from './persistence.js';
export {
  TaskCreateTool as TaskAddTool,
  TaskListTool,
  TaskCompleteTool,
  TaskUpdateTool,
  TaskAddNoteTool,
  TaskViewTool,
} from './tools.js';
export type { Task, TaskNote } from './types.js';
