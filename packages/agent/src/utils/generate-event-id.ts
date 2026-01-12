// ABOUTME: Utility for generating unique event IDs
// ABOUTME: Used by compaction strategies and other components that need unique event identifiers

/**
 * Generates a unique event ID using timestamp and random suffix.
 * Format: evt_{timestamp}_{random9chars}
 *
 * @returns A unique event ID string
 */
export function generateEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
