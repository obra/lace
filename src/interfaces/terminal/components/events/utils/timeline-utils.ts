// ABOUTME: Timeline utility functions for delegation and timeline analysis
// ABOUTME: Extracted from DelegationBox to be reusable across timeline components

import { Timeline } from '~/interfaces/timeline-types.js';

/**
 * Check if a thread timeline is complete
 * A thread is considered complete if the last item is an agent message and there are no pending tool calls
 */
export function isThreadComplete(timeline: Timeline): boolean {
  const items = timeline.items;
  if (items.length === 0) return false;

  const lastItem = items[items.length - 1];

  // Consider complete if last item is an agent message and no pending tool calls
  if (lastItem.type === 'agent_message') {
    const pendingCalls = items
      .filter((item) => item.type === 'tool_execution' && !('result' in item && item.result))
      .map((item) => (item.type === 'tool_execution' ? item.callId : ''));

    return pendingCalls.length === 0;
  }

  return false;
}

/**
 * Extract task description from timeline
 * Looks for task description in first agent message or system message
 */
export function extractTaskFromTimeline(timeline: Timeline): string {
  // Look for task description in first agent message or system message
  const firstMessage = timeline.items.find(
    (item) => item.type === 'agent_message' || item.type === 'system_message'
  );

  if (firstMessage && 'content' in firstMessage) {
    const content = firstMessage.content;
    // Check if content is empty or just whitespace
    if (!content || content.trim() === '') {
      return 'Unknown Task';
    }
    // Extract first sentence or first 50 characters
    const firstSentence = content.split('.')[0];
    return firstSentence.slice(0, 50) + (firstSentence.length > 50 ? '...' : '');
  }
  return 'Unknown Task';
}

/**
 * Calculate duration between first and last timeline items
 * Returns formatted duration string (e.g., "5s", "2m 30s", "1h 15m")
 */
export function calculateDuration(timeline: Timeline): string {
  const items = timeline.items;
  if (items.length === 0) return '0s';

  const start = items[0].timestamp;
  const end = items[items.length - 1].timestamp;
  const seconds = Math.floor((end.getTime() - start.getTime()) / 1000);

  if (seconds < 60) {
    return `${seconds}s`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
}

/**
 * Extract delegate thread ID from tool execution item
 * Looks for threadId in result metadata
 */
export function extractDelegateThreadId(item: {
  result?: { metadata?: { threadId?: unknown } };
}): string | null {
  const threadId = item.result?.metadata?.threadId;
  return threadId && typeof threadId === 'string' ? threadId : null;
}
