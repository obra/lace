// ABOUTME: Event type definitions for the web interface
// ABOUTME: Separates persisted thread events from ephemeral UI events

import type { EventType as ThreadEventType } from '@/lib/server/lace-imports';
import { EVENT_TYPES } from '@/lib/server/lace-imports';
import type { ThreadId } from '~/../types/api';

// Re-export the backend event types for thread events
export type { EventType as ThreadEventType } from '@/lib/server/lace-imports';
export { EVENT_TYPES } from '@/lib/server/lace-imports';

// UI-only event types that are NOT persisted to the database
export const UI_EVENT_TYPES = [
  'THINKING', // Agent state change, not persisted
  'TOOL_APPROVAL_REQUEST', // Approval flow, not persisted
] as const;

export type UIEventType = (typeof UI_EVENT_TYPES)[number];

// Combined event types for SSE streaming
export type SessionEventType = ThreadEventType | UIEventType;

// Helper to check if an event should be persisted
export function isPersistedEvent(type: SessionEventType): type is ThreadEventType {
  return EVENT_TYPES.includes(type as any);
}

// Get all event types for SSE listeners
export function getAllEventTypes(): SessionEventType[] {
  return [...EVENT_TYPES, ...UI_EVENT_TYPES];
}
