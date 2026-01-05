// ABOUTME: Unified core type imports for web package
// ABOUTME: Single source of truth for all core types, replaces multiple import files

// LaceEvent and related types from core (they have branded type dependencies)
export type {
  LaceEventType,
  LaceEvent,
  AgentMessageData,
  AgentStateChangeData,
  AgentSummaryUpdatedData,
  ErrorType,
  ErrorPhase,
  AgentErrorData,
} from '@lace/core/threads/types';

export { isAgentSummaryUpdatedData } from '@lace/core/threads/types';

// Token usage types from ent-protocol
export type { CombinedTokenUsage, ThreadTokenUsage } from '@lace/ent-protocol';

// Tool types - use ent-protocol for simple types, core for some
export type { ToolCall, ToolAnnotations, ToolPolicy } from '@lace/ent-protocol';
export type { ToolResult } from '@lace/core/tools/types';
export type { FileEditDiffContext } from '@lace/core/tools/implementations/file_edit';

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

// Provider types from core (they match core's internal structure)
export type { ProviderInfo, ProviderResponse, ModelInfo } from '@lace/core/providers/base-provider';

export { ApprovalDecision } from '@lace/core/tools/types';

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

// MCP types from core (matching internal structure)
export type { MCPServerConfig, DiscoveredTool, MCPConfig } from '@lace/core/config/mcp-types';

// Compaction and persona types from ent-protocol
export type { CompactionData, PersonaInfo } from '@lace/ent-protocol';

// Re-export utility functions from core
export {
  EVENT_TYPES,
  isTransientEventType,
  isInternalWorkflowEvent,
  isConversationEvent,
} from '@lace/core/threads/types';

export { asWorkspaceSessionId, isWorkspaceSessionId };
