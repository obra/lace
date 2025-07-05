// ABOUTME: Task manager tool exports for multi-agent task management
// ABOUTME: Provides SQLite-backed persistent task management with thread isolation

export { DatabasePersistence } from '../../../persistence/database.js';
export {
  TaskCreateTool,
  TaskListTool,
  TaskCompleteTool,
  TaskUpdateTool,
  TaskAddNoteTool,
  TaskViewTool,
} from './tools.js';
export type { Task, TaskNote } from './types.js';
