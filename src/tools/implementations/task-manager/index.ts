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

// Factory function no longer needed - tools get TaskManager from context
