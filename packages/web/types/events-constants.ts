// ABOUTME: Shared event type constants for client and server
// ABOUTME: Uses core thread types as single source of truth

// Import thread event types from core package to maintain consistency
import { EVENT_TYPES, type EventType } from '@/lib/core-types-import';

// Re-export for backward compatibility
export { EVENT_TYPES, type EventType };

// UI-only event types that are NOT persisted to the database
export const UI_EVENT_TYPES = [
  'THINKING', // Agent state change, not persisted
  'TOOL_APPROVAL_REQUEST', // Approval flow, not persisted
  'AGENT_TOKEN', // Streaming token, not persisted
  'AGENT_STREAMING', // Accumulated streaming content, not persisted
] as const;

export type UIEventType = (typeof UI_EVENT_TYPES)[number];

// Combined event types for SSE streaming
export type SessionEventType = EventType | UIEventType;

// Get all event types for SSE listeners
export function getAllEventTypes(): SessionEventType[] {
  return [...EVENT_TYPES, ...UI_EVENT_TYPES];
}

// Helper to check if an event should be persisted
export function isPersistedEvent(type: SessionEventType): type is EventType {
  return (EVENT_TYPES as readonly string[]).includes(type);
}
