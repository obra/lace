// ABOUTME: Timeline item focus interface and detection utilities for enabling keyboard focus on specific timeline items
// ABOUTME: Provides type-safe way to identify focusable timeline items and manage focus entry/exit

import { TimelineItem } from '~/interfaces/timeline-types';
import { FocusRegions } from '~/interfaces/terminal/focus/index';
import { ToolResult } from '~/tools/types';

/**
 * Interface for timeline items that can accept keyboard focus
 */
export interface TimelineItemFocusable {
  /**
   * Check if this item can accept keyboard focus in its current state
   */
  canAcceptFocus(): boolean;

  /**
   * Called when the user enters focus on this item (e.g., pressing Return)
   */
  onEnterFocus(): void;

  /**
   * Called when the user exits focus from this item (e.g., pressing Escape)
   */
  onExitFocus(): void;

  /**
   * Get the focus ID that should be used for this item
   */
  getFocusId(): string;
}

/**
 * Check if a timeline item supports keyboard focus entry
 * Currently supports delegate tool executions with completed results
 *
 * @param item - The timeline item to check
 * @returns true if the item can accept focus
 */
export function canTimelineItemAcceptFocus(item: TimelineItem): boolean {
  // Only tool_execution items can be focusable for now
  if (item.type !== 'tool_execution') {
    return false;
  }

  // Only delegate tool calls are focusable
  if (item.call.name !== 'delegate') {
    return false;
  }

  // Must have a completed result to be focusable
  if (!item.result || item.result.isError) {
    return false;
  }

  // Check if the result contains valid delegate thread data
  return isDelegateToolCallResult(item.result);
}

/**
 * Get the focus ID for a timeline item if it's focusable
 *
 * @param item - The timeline item
 * @returns The focus ID string, or null if the item is not focusable
 */
export function getTimelineItemFocusId(item: TimelineItem): string | null {
  if (!canTimelineItemAcceptFocus(item)) {
    return null;
  }

  if (item.type === 'tool_execution' && item.call.name === 'delegate') {
    const threadId = extractDelegateThreadId(item.result);
    return threadId ? FocusRegions.delegate(threadId) : null;
  }

  return null;
}

/**
 * Type guard to check if a value is a ToolResult
 */
function isToolResult(value: unknown): value is ToolResult {
  return (
    value !== null &&
    typeof value === 'object' &&
    'isError' in value &&
    typeof (value as ToolResult).isError === 'boolean'
  );
}

/**
 * Check if a tool result contains valid delegate thread information
 *
 * @param result - The tool result to check
 * @returns true if this is a valid delegate result with thread data
 */
export function isDelegateToolCallResult(result: unknown): boolean {
  if (!isToolResult(result) || result.isError) {
    return false;
  }

  // For delegate tool results, the thread ID is stored in metadata.threadId
  const threadId = result.metadata?.threadId;
  return typeof threadId === 'string' && threadId.length > 0;
}

/**
 * Extract the delegate thread ID from a delegate tool result
 *
 * @param result - The tool result containing delegate thread information
 * @returns The thread ID string, or null if not found
 */
export function extractDelegateThreadId(result: unknown): string | null {
  if (!isDelegateToolCallResult(result)) {
    return null;
  }

  // Since isDelegateToolCallResult ensures result is a ToolResult with valid metadata
  const toolResult = result as ToolResult;
  return (toolResult.metadata?.threadId as string) || null;
}

/**
 * Type guard to check if a timeline item is a delegate tool execution
 *
 * @param item - The timeline item to check
 * @returns true if this is a delegate tool execution item
 */
export function isDelegateToolExecution(
  item: TimelineItem
): item is Extract<TimelineItem, { type: 'tool_execution' }> & { call: { name: 'delegate' } } {
  return item.type === 'tool_execution' && item.call.name === 'delegate';
}

/**
 * Type for timeline item ref interface that supports focus entry
 */
export interface TimelineItemRef {
  /**
   * Trigger focus entry on this timeline item if it supports focus
   */
  enterFocus?: () => void;
}
