// ABOUTME: Centralized validators for supervisor-backed IDs (workspace sessions + agent sessions)
// ABOUTME: WorkspaceSessionId is ws_<uuid>; AgentSessionId uses Ent protocol sessionId rules

import { SessionIdSchema } from '@lace/ent-protocol';
import { WorkspaceSessionIdSchema } from './workspace-session-id-validation';

export type WorkspaceSessionId = string & { readonly __brand: 'WorkspaceSessionId' };
export type AgentSessionId = string & { readonly __brand: 'AgentSessionId' };

export function isWorkspaceSessionId(value: string): value is WorkspaceSessionId {
  return WorkspaceSessionIdSchema.safeParse(value).success;
}

export function asWorkspaceSessionId(value: string): WorkspaceSessionId {
  WorkspaceSessionIdSchema.parse(value);
  return value as WorkspaceSessionId;
}

export function isAgentSessionId(value: string): value is AgentSessionId {
  return SessionIdSchema.safeParse(value).success;
}

export function asAgentSessionId(value: string): AgentSessionId {
  SessionIdSchema.parse(value);
  return value as AgentSessionId;
}
