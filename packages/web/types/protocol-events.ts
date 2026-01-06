// ABOUTME: Protocol event types extracted from ent-protocol schemas.
// These are the wire-format events sent by the supervisor, wrapped for web use.
import type { z } from 'zod';
import {
  SessionUpdateNotificationSchema,
  SessionRequestPermissionRequestSchema,
} from '@lace/ent-protocol';

/**
 * Protocol event types extracted from ent-protocol schemas.
 * These are the wire-format events sent by the supervisor.
 */

// Extract base session update type from notification params
export type SessionUpdate = z.infer<typeof SessionUpdateNotificationSchema>['params'];

// Extract permission request type from request params
export type PermissionRequest = z.infer<typeof SessionRequestPermissionRequestSchema>['params'];

// Extract individual update types using discriminated union
export type TextDeltaUpdate = Extract<SessionUpdate, { type: 'text_delta' }>;
export type ThinkingUpdate = Extract<SessionUpdate, { type: 'thinking' }>;
export type UsageUpdate = Extract<SessionUpdate, { type: 'usage' }>;
export type ToolUseUpdate = Extract<SessionUpdate, { type: 'tool_use' }>;
export type TurnStartUpdate = Extract<SessionUpdate, { type: 'turn_start' }>;
export type TurnEndUpdate = Extract<SessionUpdate, { type: 'turn_end' }>;
export type ErrorUpdate = Extract<SessionUpdate, { type: 'error' }>;
export type SessionInfoUpdate = Extract<SessionUpdate, { type: 'session_info' }>;
export type ContextWindowUpdate = Extract<SessionUpdate, { type: 'context_window' }>;
export type CompactionStartUpdate = Extract<SessionUpdate, { type: 'compaction_start' }>;
export type CompactionCompleteUpdate = Extract<SessionUpdate, { type: 'compaction_complete' }>;
export type McpConfigChangedUpdate = Extract<SessionUpdate, { type: 'mcp_config_changed' }>;
export type McpServerStatusUpdate = Extract<SessionUpdate, { type: 'mcp_server_status' }>;
export type ModeChangeUpdate = Extract<SessionUpdate, { type: 'mode_change' }>;
export type ContextInjectedUpdate = Extract<SessionUpdate, { type: 'context_injected' }>;
export type PlanUpdate = Extract<SessionUpdate, { type: 'plan' }>;
export type JobStartedUpdate = Extract<SessionUpdate, { type: 'job_started' }>;
export type JobFinishedUpdate = Extract<SessionUpdate, { type: 'job_finished' }>;
export type JobUpdateUpdate = Extract<SessionUpdate, { type: 'job_update' }>;

/**
 * Web-specific wrapper for protocol events.
 * Adds metadata and context needed for web UI.
 */
export interface ProtocolEvent {
  // Event metadata
  id: string;
  timestamp: Date;

  // Protocol update data
  update: SessionUpdate;

  // Context from supervisor
  workspaceSessionId: string;
  projectId?: string;
  agentSessionId: string; // from update.sessionId
}

/**
 * Web-specific wrapper for permission request events.
 */
export interface PermissionRequestEvent {
  id: string;
  timestamp: Date;
  request: PermissionRequest;
  workspaceSessionId: string;
  projectId?: string;
}
