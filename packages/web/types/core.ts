// ABOUTME: Unified core type imports for web package
// ABOUTME: Single source of truth for all core types, replaces multiple import files

// Re-export all core types that web package needs
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

export type { CombinedTokenUsage, ThreadTokenUsage } from '@lace/core/token-management/types';

export type { ToolCall, ToolResult, ToolAnnotations, ToolPolicy } from '@lace/core/tools/types';

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

export type { ProviderInfo, ProviderResponse, ModelInfo } from '@lace/core/providers/base-provider';

export { ApprovalDecision } from '@lace/core/tools/types';

export type { ProjectInfo } from '@lace/core/projects/project';

export interface SessionInfo {
  id: WorkspaceSessionId;
  name: string;
  description?: string;
  createdAt: Date;
  agents?: AgentInfo[];
  agentCount?: number;
}

export type { MCPServerConfig, DiscoveredTool, MCPConfig } from '@lace/core/config/mcp-types';

export type { CompactionData } from '@lace/core/threads/compaction/types';

export type { PersonaInfo } from '@lace/core/config/persona-registry';

// Re-export utility functions
export {
  EVENT_TYPES,
  isTransientEventType,
  isInternalWorkflowEvent,
  isConversationEvent,
} from '@lace/core/threads/types';

export { asWorkspaceSessionId, isWorkspaceSessionId };
