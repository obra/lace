// ABOUTME: Semantic focus region constants for terminal UI components
// ABOUTME: Provides type-safe focus ID constants to prevent typos and enable autocomplete

/**
 * Semantic constants for focus regions in the terminal interface.
 *
 * These constants provide:
 * - Type safety to prevent focus ID typos
 * - IDE autocomplete for available focus regions
 * - Centralized management of focus identifiers
 * - Dynamic ID generation for parameterized regions
 *
 * Usage:
 * - Static regions: FocusRegions.shell, FocusRegions.timeline
 * - Dynamic regions: FocusRegions.delegate(threadId), FocusRegions.modal(type)
 */
export const FocusRegions = {
  /**
   * Main shell input area where users type commands
   */
  shell: 'shell-input',

  /**
   * Timeline viewport for viewing conversation history
   */
  timeline: 'timeline',

  /**
   * File autocomplete dropdown in the shell
   */
  autocomplete: 'autocomplete',

  /**
   * Generate a modal focus ID for a specific modal type
   * @param type - The type of modal (e.g., 'approval', 'confirmation')
   * @returns A unique focus ID for the modal
   */
  modal: (type: string): string => `modal-${type}`,

  /**
   * Generate a delegation focus ID for a specific thread
   * @param threadId - The delegate thread ID
   * @returns A unique focus ID for the delegation box
   */
  delegate: (threadId: string): string => `delegate-${threadId}`,
} as const;

/**
 * Type representing all possible static focus region values
 */
export type StaticFocusRegion =
  | typeof FocusRegions.shell
  | typeof FocusRegions.timeline
  | typeof FocusRegions.autocomplete;

/**
 * Type representing the structure of dynamic focus region generators
 */
export type DynamicFocusRegion = typeof FocusRegions.modal | typeof FocusRegions.delegate;
