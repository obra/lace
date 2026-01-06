// ABOUTME: Unified type imports for web package
// ABOUTME: Single source of truth for all shared types, replaces multiple import files
// ABOUTME: Wire protocol types from @lace/ent-protocol, runtime event types from @lace/agent

// Runtime event helper types from agent
// ErrorType and ErrorPhase are kept as they're general-purpose error types
export type {
  AgentMessageData,
  AgentStateChangeData,
  AgentSummaryUpdatedData,
  AgentErrorData,
  ErrorType,
  ErrorPhase,
} from '@lace/agent/threads/types';

export { isAgentSummaryUpdatedData } from '@lace/agent/threads/types';

// Token usage types from ent-protocol (wire protocol)
export type { CombinedTokenUsage, ThreadTokenUsage } from '@lace/ent-protocol';

// Tool types from ent-protocol (wire protocol)
// Note: Some types are exported with App* prefix to avoid conflicts with schema types
export type { ToolCall, ToolAnnotations, ToolPolicy } from '@lace/ent-protocol';
export type { AppToolResult as ToolResult } from '@lace/ent-protocol';
export type { FileEditDiffContext } from '@lace/ent-protocol';

import {
  asAgentSessionId,
  asWorkspaceSessionId,
  isAgentSessionId,
  isWorkspaceSessionId,
} from '@lace/web/lib/validation/session-id-validation';
import type {
  AgentSessionId,
  WorkspaceSessionId,
} from '@lace/web/lib/validation/session-id-validation';

export type {
  AgentSessionId,
  WorkspaceSessionId,
} from '@lace/web/lib/validation/session-id-validation';

// In the supervisor-backed web app, route and UI "threadId" refers to the agent protocol sessionId.
export type ThreadId = AgentSessionId;

export function isThreadId(value: string): value is ThreadId {
  return isAgentSessionId(value);
}

export function asThreadId(value: string): ThreadId {
  return asAgentSessionId(value) as ThreadId;
}

export type AgentState = 'idle' | 'thinking' | 'streaming' | 'tool_execution';

export interface AgentInfo {
  threadId: AgentSessionId;
  name: string;
  providerInstanceId: string;
  modelId: string;
  status: AgentState;
  persona?: string;
  createdAt?: Date;
}

// Provider types from ent-protocol (wire protocol)
// Note: These use App* prefix in ent-protocol to avoid conflicts with schema types
export type {
  AppProviderInfo as ProviderInfo,
  AppProviderResponse as ProviderResponse,
  AppModelInfo as ModelInfo,
} from '@lace/ent-protocol';

export { ApprovalDecision } from '@lace/ent-protocol';

// Project and workspace types from ent-protocol
export type { ProjectInfo, WorkspaceInfo } from '@lace/ent-protocol';

export interface SessionInfo {
  id: WorkspaceSessionId;
  name: string;
  description?: string;
  createdAt: Date;
  agents?: AgentInfo[];
  agentCount?: number;
}

// MCP types from ent-protocol (wire protocol)
// Note: MCPServerConfig uses App* prefix in ent-protocol to avoid conflicts with schema types
export type { AppMCPServerConfig as MCPServerConfig } from '@lace/ent-protocol';
export type { DiscoveredTool, MCPConfig } from '@lace/ent-protocol';

// Compaction and persona types from ent-protocol
export type { CompactionData, PersonaInfo } from '@lace/ent-protocol';

export { asWorkspaceSessionId, isWorkspaceSessionId };
