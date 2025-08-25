// ABOUTME: Main entry point for @lace/core package
// ABOUTME: Exports key classes and types for external consumption

// Core agent functionality
export { Agent } from './agents/agent';
export type { AgentState, AgentInfo } from './agents/agent';

// Thread management
export { ThreadManager } from './threads/thread-manager';
export type { ThreadId, LaceEvent, LaceEventType, ErrorType, ErrorPhase } from './threads/types';

// Provider system
export { ProviderRegistry } from './providers/registry';
export type { ProviderInfo, ProviderResponse } from './providers/base-provider';

// Tool system
export { ToolExecutor } from './tools/executor';
export type { ToolCall, ToolResult } from './tools/types';

// Session and project management
export { Session } from './sessions/session';
export { Project } from './projects/project';

// Configuration
export { ensureLaceDir } from './config/lace-dir';

// Utilities
export { logger } from './utils/logger';
