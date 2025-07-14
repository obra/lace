// ABOUTME: Server-side imports for Lace core modules
// ABOUTME: Uses module path aliases that must be configured in build tools

// Import from built Lace dist directory
// These paths assume the web app is run from packages/web
export { Agent } from '~/agents/agent';
export { ThreadManager } from '~/threads/thread-manager';
export { ProviderRegistry } from '~/providers/registry';
export { ToolExecutor } from '~/tools/executor';
export { getLaceDbPath } from '~/config/lace-dir';
export { getEnvVar } from '~/config/env-loader';
export { DelegateTool } from '~/tools/implementations/delegate';

// Types can use source paths since they're compile-time only
export type { ThreadId } from '~/types/threads';
export type { ThreadEvent, EventType } from '~/threads/types';
export type { ApprovalDecision } from '~/tools/approval-types';
export type { ToolAnnotations } from '~/tools/types';
export type { AgentState } from '~/agents/agent';
export type { ProviderInfo, ModelInfo } from '~/providers/base-provider';

// Constants can be imported from built code
export { EVENT_TYPES } from '~/threads/types';
