// ABOUTME: Server-Sent Events (SSE) specific types for real-time event streaming
// ABOUTME: Re-exports ThreadEvent as SessionEvent for backward compatibility during migration

import type { ThreadEvent } from '~/threads/types';

// Re-export ThreadEvent as SessionEvent for backward compatibility
// This allows gradual migration of components
export type SessionEvent = ThreadEvent;

// Re-export ThreadEvent directly for new code
export type { ThreadEvent };

// Re-export other types from threads/types for convenience
export type { ThreadEventType, ThreadId } from '~/threads/types';
export { EVENT_TYPES } from '~/threads/types';
