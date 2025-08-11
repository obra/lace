// ABOUTME: Unified core type imports for web package
// ABOUTME: Single source of truth for all core types, replaces multiple import files

// Re-export all core types that web package needs
export type {
  ThreadId,
  AssigneeId,
  ThreadEventType,
  ThreadEvent,
  Thread,
  AgentMessageData,
} from '~/threads/types';

export type {
  MessageTokenUsage,
  ThreadTokenUsage,
  CombinedTokenUsage,
} from '~/token-management/types';

export type { ToolCall, ToolResult, ToolContext, ToolAnnotations } from '~/tools/types';

export type { FileEditDiffContext } from '~/tools/implementations/file-edit';

export type {
  Task,
  TaskNote,
  TaskStatus,
  TaskPriority,
  TaskActor,
  TaskContext,
  TaskFilters,
} from '~/tasks/types';

export type { AgentState, AgentInfo } from '~/agents/agent';

export type { ProviderInfo, ModelInfo, ProviderResponse } from '~/providers/base-provider';

export { ApprovalDecision } from '~/tools/approval-types';

export type { ProjectInfo } from '~/projects/project';

export type { SessionInfo } from '~/sessions/session';

export type { CompactionData } from '~/threads/compaction/types';

// Re-export utility functions
export {
  asThreadId,
  isThreadId,
  asNewAgentSpec,
  createNewAgentSpec,
  asAssigneeId,
  isAssigneeId,
  EVENT_TYPES,
  isTransientEventType,
} from '~/threads/types';
