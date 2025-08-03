// ABOUTME: Core event system types for real-time streaming
// ABOUTME: Defines canonical event structure used across all interfaces

import type { ThreadId } from '~/threads/types';

// =============================================================================
// CORE EVENT ARCHITECTURE
// =============================================================================

// Stream event category union - primary event categories
export type StreamEventCategory = 'session' | 'task' | 'project' | 'global';

// Event scope for hierarchical filtering and routing
export interface EventScope {
  projectId?: string;
  sessionId?: string;
  threadId?: string;
  taskId?: string;
  global?: boolean;
}

// Consistent context structure for all events
export interface EventContext {
  actor: string; // Who triggered the event
  isHuman: boolean; // Human vs AI action
}

// =============================================================================
// TASK EVENTS
// =============================================================================

// Import the actual types - JSON.stringify will handle serialization
import type { Task, TaskContext } from '~/tasks/types';

export interface TaskEventData {
  type: 'task:created' | 'task:updated' | 'task:deleted' | 'task:note_added';
  taskId: string;
  task?: Task; // Use actual Task type - JSON.stringify handles conversion
  context: TaskContext; // Use actual TaskContext
  timestamp: string; // Keep as string since we set this explicitly
}

// =============================================================================
// AGENT EVENTS
// =============================================================================

export interface AgentEventData {
  type: 'agent:spawned' | 'agent:started' | 'agent:stopped';
  taskId?: string;
  agentThreadId: ThreadId;
  provider: string;
  model: string;
  context: EventContext;
  timestamp: string; // ISO string
}

// =============================================================================
// PROJECT EVENTS
// =============================================================================

export interface ProjectEventData {
  type: 'project:created' | 'project:updated' | 'project:deleted';
  projectId: string;
  project: {
    id: string;
    name: string;
    description?: string;
    path: string;
  };
  context: EventContext;
  timestamp: string; // ISO string
}

// =============================================================================
// GLOBAL EVENTS
// =============================================================================

export interface GlobalEventData {
  type: 'system:maintenance' | 'system:update' | 'system:notification';
  message: string;
  severity: 'info' | 'warning' | 'error';
  context: EventContext;
  timestamp: string; // ISO string
}

// =============================================================================
// SESSION EVENTS (Legacy - for existing session system)
// =============================================================================

export interface SessionEventData {
  type:
    | 'USER_MESSAGE'
    | 'AGENT_MESSAGE'
    | 'AGENT_TOKEN'
    | 'TOOL_CALL'
    | 'TOOL_RESULT'
    | 'TOOL_APPROVAL_REQUEST'
    | 'TOOL_APPROVAL_RESPONSE'
    | 'LOCAL_SYSTEM_MESSAGE';
  threadId: ThreadId;
  timestamp: string; // ISO string - CONSISTENT with all other events
  data: unknown; // Legacy - specific to session system
}

// =============================================================================
// UNIFIED STREAM EVENT ARCHITECTURE
// =============================================================================

// Unified stream event wrapper - the canonical event format
export interface StreamEvent {
  id: string; // Unique event identifier
  timestamp: string; // ISO string - CONSISTENT across all events
  eventType: StreamEventCategory; // Primary categorization
  scope: EventScope; // Hierarchical routing information
  data: SessionEventData | TaskEventData | AgentEventData | ProjectEventData | GlobalEventData;
}

// Client-side subscription options with type safety
export interface StreamSubscription {
  projects?: string[]; // Filter to specific project IDs
  sessions?: string[]; // Filter to specific session IDs
  threads?: string[]; // Filter to specific thread IDs
  global?: boolean; // Include global system events
  eventTypes?: StreamEventCategory[]; // Filter to specific event types (type-safe!)
}

// =============================================================================
// TYPE-SAFE EVENT CREATION HELPERS
// =============================================================================

export function createTaskEvent(
  type: TaskEventData['type'],
  taskId: string,
  task: TaskEventData['task'],
  context: EventContext,
  scope: EventScope
): Omit<StreamEvent, 'id' | 'timestamp'> {
  return {
    eventType: 'task',
    scope: { ...scope, taskId },
    data: {
      type,
      taskId,
      task,
      context,
      timestamp: new Date().toISOString(),
    },
  };
}

export function createAgentEvent(
  type: AgentEventData['type'],
  agentThreadId: ThreadId,
  provider: string,
  model: string,
  context: EventContext,
  scope: EventScope,
  taskId?: string
): Omit<StreamEvent, 'id' | 'timestamp'> {
  return {
    eventType: 'task', // Agent events are task-scoped
    scope: taskId ? { ...scope, taskId } : scope,
    data: {
      type,
      agentThreadId,
      provider,
      model,
      context,
      timestamp: new Date().toISOString(),
      ...(taskId && { taskId }),
    },
  };
}

export function createProjectEvent(
  type: ProjectEventData['type'],
  projectId: string,
  project: ProjectEventData['project'],
  context: EventContext,
  scope: EventScope
): Omit<StreamEvent, 'id' | 'timestamp'> {
  return {
    eventType: 'project',
    scope: { ...scope, projectId },
    data: {
      type,
      projectId,
      project,
      context,
      timestamp: new Date().toISOString(),
    },
  };
}

export function createGlobalEvent(
  type: GlobalEventData['type'],
  message: string,
  severity: GlobalEventData['severity'],
  context: EventContext,
  scope: EventScope = { global: true }
): Omit<StreamEvent, 'id' | 'timestamp'> {
  return {
    eventType: 'global',
    scope,
    data: {
      type,
      message,
      severity,
      context,
      timestamp: new Date().toISOString(),
    },
  };
}

export function createSessionEvent(
  type: SessionEventData['type'],
  threadId: ThreadId,
  data: unknown,
  scope: EventScope
): Omit<StreamEvent, 'id' | 'timestamp'> {
  return {
    eventType: 'session',
    scope,
    data: {
      type,
      threadId,
      data,
      timestamp: new Date().toISOString(),
    },
  };
}

// =============================================================================
// TYPE GUARDS FOR EVENT DISCRIMINATION
// =============================================================================

export function isTaskEvent(event: StreamEvent): event is StreamEvent & { data: TaskEventData } {
  return event.eventType === 'task' && 'taskId' in event.data;
}

export function isAgentEvent(event: StreamEvent): event is StreamEvent & { data: AgentEventData } {
  return event.eventType === 'task' && 'agentThreadId' in event.data;
}

export function isProjectEvent(
  event: StreamEvent
): event is StreamEvent & { data: ProjectEventData } {
  return event.eventType === 'project';
}

export function isGlobalEvent(
  event: StreamEvent
): event is StreamEvent & { data: GlobalEventData } {
  return event.eventType === 'global';
}

export function isSessionEvent(
  event: StreamEvent
): event is StreamEvent & { data: SessionEventData } {
  return event.eventType === 'session';
}
