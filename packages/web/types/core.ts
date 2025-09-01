// ABOUTME: Unified core type imports for web package
// ABOUTME: Single source of truth for all core types, replaces multiple import files

// Re-export all core types that web package needs
export type {
  ThreadId,
  AssigneeId,
  LaceEventType,
  LaceEvent,
  AgentMessageData,
  AgentStateChangeData,
  AgentSummaryUpdatedData,
  ErrorType,
  ErrorPhase,
  AgentErrorData,
} from '~/threads/types';

export { isAgentSummaryUpdatedData } from '~/threads/types';

export type { CombinedTokenUsage, ThreadTokenUsage } from '~/token-management/types';

export type { ToolCall, ToolResult, ToolAnnotations } from '~/tools/types';

export type { FileEditDiffContext } from '~/tools/implementations/file-edit';

export type {
  Task,
  TaskNote,
  TaskStatus,
  TaskPriority,
  TaskContext,
  TaskFilters,
} from '~/tasks/types';

export type { AgentState, AgentInfo } from '~/agents/agent';

export type { ProviderInfo, ProviderResponse, ModelInfo } from '~/providers/base-provider';

export { ApprovalDecision } from '~/tools/approval-types';

export type { ProjectInfo } from '~/projects/project';

export type { SessionInfo } from '~/sessions/session';

export type { CompactionData } from '~/threads/compaction/types';

// Re-export utility functions
export {
  asThreadId,
  isThreadId,
  asNewAgentSpec,
  asAssigneeId,
  EVENT_TYPES,
  isTransientEventType,
  isInternalWorkflowEvent,
  isConversationEvent,
} from '~/threads/types';
