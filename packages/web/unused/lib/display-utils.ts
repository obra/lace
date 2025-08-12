// ABOUTME: Display formatting utilities for UI components
// ABOUTME: Provides safe, consistent formatting for ThreadIds and other core types

import { isValidThreadId } from '@/lib/validation/thread-id-validation';

/**
 * Formats a ThreadId for display by extracting a human-readable name
 * Handles both session IDs (lace_YYYYMMDD_name) and agent IDs (lace_YYYYMMDD_name.N)
 */
export function formatThreadIdForDisplay(threadId: string): string {
  // Validate input using client-safe validation
  if (!isValidThreadId(threadId)) {
    return threadId; // Return as-is if not a valid ThreadId
  }

  // Handle agent ThreadIds (with .N suffix)
  if (threadId.includes('.')) {
    const parts = threadId.split('.');
    const sessionPart = parts[0];
    const agentNumber = parts.slice(1).join('.');

    if (sessionPart && sessionPart.startsWith('lace_')) {
      const sessionName = sessionPart.split('_').slice(2).join('_');
      return sessionName ? `${sessionName}.${agentNumber}` : `agent.${agentNumber}`;
    }
    return `agent.${agentNumber}`;
  }

  // Handle session ThreadIds (lace_YYYYMMDD_name format)
  if (threadId.startsWith('lace_')) {
    const parts = threadId.split('_');
    if (parts.length >= 3) {
      // Join everything after date as the name
      const name = parts.slice(2).join('_');
      return name || 'session';
    }
  }

  // Handle UUIDs or other formats
  if (threadId.includes('-')) {
    // For UUIDs, show first 8 characters
    return threadId.substring(0, 8);
  }

  // Fallback to original value
  return threadId;
}

/**
 * Formats an assignee ThreadId for task assignment display
 * Special handling for unassigned tasks and 'new:' prefixed values
 */
export function formatAssigneeForDisplay(assignedTo?: string): string {
  if (!assignedTo) {
    return 'Unassigned';
  }

  // Handle special 'new:' prefixed values
  if (assignedTo.startsWith('new:')) {
    return assignedTo;
  }

  // Use the general ThreadId formatter
  return formatThreadIdForDisplay(assignedTo);
}

/**
 * Formats an author ThreadId for note/comment display
 * Similar to formatThreadIdForDisplay but optimized for author context
 */
export function formatAuthorForDisplay(author: string): string {
  return formatThreadIdForDisplay(author);
}
