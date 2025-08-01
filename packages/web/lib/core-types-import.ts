// ABOUTME: Client-safe imports for core types only (no server-only restrictions)
// ABOUTME: Used by client-side code that needs type definitions from core

// Import only types and constants that are safe for client use
export { EVENT_TYPES, type EventType } from '~/threads/types';
export type { ThreadEvent, Thread, ThreadId, AssigneeId } from '~/threads/types';
export type { CompactionData } from '~/threads/compaction/types';
export type { Task, TaskNote, TaskStatus, TaskPriority } from '~/tasks/types';
export type { ToolResult } from '~/tools/types';
