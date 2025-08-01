// ABOUTME: Unified core type imports for web package
// ABOUTME: Single source of truth for all core types, replaces multiple import files

// Re-export all core types that web package needs
export type { ThreadId, AssigneeId, EventType, ThreadEvent, Thread } from '~/threads/types';

export type { ToolCall, ToolResult, ToolContext, ToolAnnotations } from '~/tools/types';

export type { Task, TaskNote, TaskStatus, TaskPriority } from '~/tasks/types';

export type { AgentState } from '~/agents/agent';

export type { ProviderInfo, ModelInfo } from '~/providers/base-provider';

export { ApprovalDecision } from '~/tools/approval-types';

export type { ProjectInfo } from '~/projects/project';

// Re-export utility functions
export {
  asThreadId,
  createThreadId,
  isThreadId,
  asNewAgentSpec,
  createNewAgentSpec,
  EVENT_TYPES,
} from '~/threads/types';
