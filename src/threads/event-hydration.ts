// ABOUTME: Utilities for ensuring LaceEvent objects have proper Date timestamps
// ABOUTME: Handles deserialization from JSON where Date objects become strings

import type { LaceEvent } from '~/threads/types';

/**
 * Ensures a LaceEvent has a proper Date timestamp.
 *
 * This handles cases where events have been serialized to JSON
 * (e.g., in compaction data) and Date objects became strings.
 */
export function hydrateEvent(event: LaceEvent): LaceEvent {
  return {
    ...event,
    timestamp: event.timestamp instanceof Date ? event.timestamp : new Date(event.timestamp!),
  };
}

/**
 * Ensures an array of LaceEvents all have proper Date timestamps.
 */
export function hydrateEvents(events: LaceEvent[]): LaceEvent[] {
  return events.map(hydrateEvent);
}

/**
 * Type guard to check if an event has a proper Date timestamp.
 */
export function hasDateTimestamp(event: LaceEvent): boolean {
  return event.timestamp instanceof Date;
}

/**
 * Type guard to check if all events in an array have proper Date timestamps.
 */
export function allEventsHaveDateTimestamps(events: LaceEvent[]): boolean {
  return events.every(hasDateTimestamp);
}
