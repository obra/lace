// ABOUTME: Shared event type constants for client and server
// ABOUTME: Pure constants with no dependencies to prevent client/server boundary violations

// Thread event types that are persisted to database
// This mirrors the EVENT_TYPES constant from the main project's src/threads/types.ts
export const EVENT_TYPES = [
  'USER_MESSAGE',
  'AGENT_MESSAGE',
  'TOOL_CALL',
  'TOOL_RESULT',
  'LOCAL_SYSTEM_MESSAGE',
  'SYSTEM_PROMPT',
  'USER_SYSTEM_PROMPT',
] as const;

// Type derived from the array
export type EventType = (typeof EVENT_TYPES)[number];

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
