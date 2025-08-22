// ABOUTME: Test utilities for handling nullable LaceEvent returns from addEvent()
// ABOUTME: Provides type-safe helpers for tests that expect events to be added successfully

import type { LaceEvent } from '~/threads/types';

/**
 * Helper function for tests that expect events to be added successfully.
 * Throws a descriptive error if the event is null, otherwise returns the event.
 */
export function expectEventAdded<T extends LaceEvent | null>(
  result: T,
  message?: string
): NonNullable<T> {
  if (result === null) {
    throw new Error(message || 'Expected event to be added successfully, but got null');
  }
  return result as NonNullable<T>;
}
