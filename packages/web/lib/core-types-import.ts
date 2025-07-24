// ABOUTME: Client-safe imports for core types only (no server-only restrictions)
// ABOUTME: Used by client-side code that needs type definitions from core

// Import only types and constants that are safe for client use
export { EVENT_TYPES, type EventType } from '~/threads/types';
export type { ThreadEvent, Thread } from '~/threads/types';
export type { CompactionData } from '~/threads/compaction/types';
