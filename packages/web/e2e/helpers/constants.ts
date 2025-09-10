// ABOUTME: Standard timeout and delay constants for E2E tests
// ABOUTME: Eliminates arbitrary timing values and provides semantic wait times

/**
 * Standard timeout constants for E2E tests
 * Use these instead of hardcoded values for consistency
 */
export const TIMEOUTS = {
  QUICK: 5000, // Element visibility, form interactions
  STANDARD: 10000, // AI responses, navigation
  EXTENDED: 15000, // Complex operations, streaming
} as const;

/**
 * Standard delay constants for waitForTimeout calls
 * Use these for UI stabilization between operations
 */
export const DELAYS = {
  SHORT: 1000, // Brief UI stabilization delays
  MEDIUM: 1500, // Moderate processing delays
  LONG: 2000, // Extended processing delays
  EXTENDED: 3000, // Long processing or compaction delays
} as const;
