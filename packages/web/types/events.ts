// ABOUTME: Event type definitions for the web interface
// ABOUTME: Re-exports shared event constants to prevent client/server boundary violations

export type { EventType, SessionEventType, UIEventType } from '@/types/events-constants';
export {
  EVENT_TYPES,
  UI_EVENT_TYPES,
  getAllEventTypes,
  isPersistedEvent,
} from '@/types/events-constants';
