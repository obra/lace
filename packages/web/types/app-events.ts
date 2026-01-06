// ABOUTME: Unified app event types combining protocol events and web events.
// Provides type guards for safe event discrimination and helper functions
// to extract common properties from any event type.

import type { ProtocolEvent, PermissionRequestEvent } from './protocol-events';
import type { WebEvent } from './web-events';

/**
 * Union type for all events that the web application handles.
 * Combines protocol events from supervisor with web-internal events.
 */
export type AppEvent = ProtocolEvent | PermissionRequestEvent | WebEvent;

/**
 * Type guard to check if an event is a protocol event
 */
export function isProtocolEvent(event: AppEvent): event is ProtocolEvent {
  return 'update' in event && event.update !== undefined;
}

/**
 * Type guard to check if an event is a permission request event
 */
export function isPermissionRequestEvent(event: AppEvent): event is PermissionRequestEvent {
  return 'request' in event && event.request !== undefined;
}

/**
 * Type guard to check if an event is a web-internal event
 */
export function isWebEvent(event: AppEvent): event is WebEvent {
  return (
    'type' in event &&
    typeof event.type === 'string' &&
    !('update' in event) &&
    !('request' in event)
  );
}

/**
 * Extract the event type for filtering and routing
 * Returns a string in the format "protocol:type" or "web:type"
 */
export function getEventType(event: AppEvent): string {
  if (isProtocolEvent(event)) {
    return `protocol:${event.update.type}`;
  }
  if (isPermissionRequestEvent(event)) {
    return 'protocol:permission_request';
  }
  if (isWebEvent(event)) {
    return `web:${event.type}`;
  }
  return 'unknown';
}

/**
 * Get the agent session ID from any event type
 * Returns undefined if the event doesn't have an agent session ID
 */
export function getAgentSessionId(event: AppEvent): string | undefined {
  if (isProtocolEvent(event)) {
    return event.agentSessionId;
  }
  if (isWebEvent(event)) {
    return event.agentSessionId;
  }
  if (isPermissionRequestEvent(event)) {
    return event.request.sessionId;
  }
  return undefined;
}

/**
 * Get the workspace session ID from any event type
 * Returns undefined if the event doesn't have a workspace session ID
 */
export function getWorkspaceSessionId(event: AppEvent): string | undefined {
  if (isProtocolEvent(event) || isPermissionRequestEvent(event) || isWebEvent(event)) {
    return event.workspaceSessionId;
  }
  return undefined;
}
