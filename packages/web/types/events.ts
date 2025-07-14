// ABOUTME: Event type definitions for the web interface
// ABOUTME: Separates persisted thread events from ephemeral UI events

import type { EventType as ThreadEventType } from '@/lib/server/lace-imports';
import type { ThreadId } from './api';

// Re-export the backend event types for thread events
export type { EventType as ThreadEventType } from '@/lib/server/lace-imports';

// UI-only event types that are NOT persisted to the database
export type UIEventType = 
  | 'THINKING'           // Agent state change, not persisted
  | 'TOOL_APPROVAL_REQUEST'; // Approval flow, not persisted

// Combined event types for SSE streaming
export type SessionEventType = ThreadEventType | UIEventType;

// Helper to check if an event should be persisted
export function isPersistedEvent(type: SessionEventType): type is ThreadEventType {
  const threadEvents: ThreadEventType[] = [
    'USER_MESSAGE',
    'AGENT_MESSAGE', 
    'TOOL_CALL',
    'TOOL_RESULT',
    'LOCAL_SYSTEM_MESSAGE',
    'SYSTEM_PROMPT',
    'USER_SYSTEM_PROMPT'
  ];
  return threadEvents.includes(type as ThreadEventType);
}

// Get all event types for SSE listeners
export function getAllEventTypes(): SessionEventType[] {
  const threadEvents: ThreadEventType[] = [
    'USER_MESSAGE',
    'AGENT_MESSAGE',
    'TOOL_CALL', 
    'TOOL_RESULT',
    'LOCAL_SYSTEM_MESSAGE',
    'SYSTEM_PROMPT',
    'USER_SYSTEM_PROMPT'
  ];
  
  const uiEvents: UIEventType[] = [
    'THINKING',
    'TOOL_APPROVAL_REQUEST'
  ];
  
  return [...threadEvents, ...uiEvents];
}