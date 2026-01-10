// ABOUTME: Package exports - core library for embedded usage + RPC server

// Core library (for embedded usage without RPC)
export { Agent } from './core/agent';
export { Session } from './core/session';
export { ConversationRunner } from './core/conversation/runner';

// Core types
export type {
  AgentConfig,
  SessionConfig,
  PromptParams,
  TurnResult,
  SessionUpdate,
  SessionUpdateHandler,
} from './core/types';

// Conversation types
export type { RunnerConfig, RunParams, RunResult } from './core/conversation/types';

// Special tools
export { isSpecialTool, executeSpecialTool } from './core/tools/special';
export type { SpecialToolContext, SpecialToolResult, JobState, JobRecord } from './core/tools/special';

// RPC server (for JSON-RPC usage)
export * from './server';

// Message building utilities
export { buildProviderMessagesFromDurableEvents, estimateProviderTokens } from './message-building/message-builder';
