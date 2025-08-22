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
} from '@lace/core/threads/types';

export type { CombinedTokenUsage, ThreadTokenUsage } from '@lace/core/token-management/types';

export type { ToolCall, ToolResult, ToolAnnotations } from '@lace/core/tools/types';

export type { FileEditDiffContext } from '@lace/core/tools/implementations/file-edit';

export type {
  Task,
  TaskNote,
  TaskStatus,
  TaskPriority,
  TaskContext,
  TaskFilters,
} from '@lace/core/tasks/types';

export type { AgentState, AgentInfo } from '@lace/core/agents/agent';

export type { ProviderInfo, ProviderResponse, ModelInfo } from '@lace/core/providers/base-provider';

export { ApprovalDecision } from '@lace/core/tools/approval-types';

export type { ProjectInfo } from '@lace/core/projects/project';

export type { SessionInfo } from '@lace/core/sessions/session';

export type { CompactionData } from '@lace/core/threads/compaction/types';

export type { Tool } from '@lace/core/tools/tool';

export type { TempLaceDirContext } from '@lace/core/test-utils/temp-lace-dir';

// Re-export task status constants and functions
export {
  TASK_STATUS_CONFIG,
  TASK_STATUS_ORDERED,
  TASK_STATUS_VALUES,
  getStatusConfig,
} from '@lace/core/tasks/task-status';

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
} from '@lace/core/threads/types';
