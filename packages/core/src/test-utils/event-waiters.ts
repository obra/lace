// ABOUTME: Utilities for waiting on specific events in tests
// ABOUTME: Provides event-based synchronization instead of arbitrary timeouts

import type { ThreadManager } from '~/threads/thread-manager';
import type { LaceEvent, LaceEventType } from '~/threads/types';

/**
 * Wait for a specific event type to appear in thread
 * Resolves with the first matching event found
 */
export function waitForEvent(
  threadManager: ThreadManager,
  threadId: string,
  eventType: LaceEventType,
  timeoutMs = 5000
): Promise<LaceEvent> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const checkForEvent = () => {
      const events = threadManager.getEvents(threadId);
      const event = events.find((e) => e.type === eventType);
      if (event) {
        resolve(event);
      } else if (Date.now() - startTime > timeoutMs) {
        reject(new Error(`Timeout waiting for ${eventType} event after ${timeoutMs}ms`));
      } else {
        setTimeout(checkForEvent, 10);
      }
    };
    checkForEvent();
  });
}

/**
 * Wait for a specific number of events of a given type
 * Resolves with all matching events once count is reached
 */
export function waitForEventCount(
  threadManager: ThreadManager,
  threadId: string,
  eventType: LaceEventType,
  count: number,
  timeoutMs = 5000
): Promise<LaceEvent[]> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const checkForEvents = () => {
      const events = threadManager.getEvents(threadId);
      const matchingEvents = events.filter((e) => e.type === eventType);
      if (matchingEvents.length >= count) {
        resolve(matchingEvents);
      } else if (Date.now() - startTime > timeoutMs) {
        reject(
          new Error(
            `Timeout waiting for ${count} ${eventType} events after ${timeoutMs}ms (got ${matchingEvents.length})`
          )
        );
      } else {
        setTimeout(checkForEvents, 10);
      }
    };
    checkForEvents();
  });
}

/**
 * Wait for an event matching a custom predicate
 * Useful for waiting on specific event data
 */
export function waitForEventMatch(
  threadManager: ThreadManager,
  threadId: string,
  predicate: (event: LaceEvent) => boolean,
  description: string,
  timeoutMs = 5000
): Promise<LaceEvent> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const checkForEvent = () => {
      const events = threadManager.getEvents(threadId);
      const event = events.find(predicate);
      if (event) {
        resolve(event);
      } else if (Date.now() - startTime > timeoutMs) {
        reject(new Error(`Timeout waiting for ${description} after ${timeoutMs}ms`));
      } else {
        setTimeout(checkForEvent, 10);
      }
    };
    checkForEvent();
  });
}
