// ABOUTME: Main entry point for @lace/core package
// ABOUTME: Exports key classes and types for external consumption

// Thread types
export type {
  ThreadId,
  LaceEvent,
  LaceEventType,
  ErrorType,
  ErrorPhase,
  AgentErrorData,
} from './threads/types';
export { isErrorType, isErrorPhase } from './threads/types';

// Provider system
export { ProviderRegistry } from './providers/registry';
export type { ProviderInfo, ProviderResponse } from './providers/base-provider';

// Tool system
export { ToolExecutor } from './tools/executor';
export { ToolCatalog } from './tools/tool-catalog';
export type { ToolCall, ToolResult } from './tools/types';

// Session and project management
export { Project } from './projects/project';

// Configuration
export { ensureLaceDir } from './config/lace-dir';

// Helper system
export * from './helpers';

// Utilities
export { logger } from './utils/logger';
