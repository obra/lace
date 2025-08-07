// ABOUTME: Server-side imports for Lace core modules - BUSINESS LOGIC CLASSES ONLY
// ABOUTME: Uses ~ path aliases to reference main project source

import 'server-only';

// Business logic classes - should only be used by service layer
export { Agent, type AgentEvents } from '~/agents/agent';
export { ProviderRegistry } from '~/providers/registry';
export { ProviderCatalogManager } from '~/providers/catalog/manager';
export { ProviderInstanceManager } from '~/providers/instance/manager';
export { ToolExecutor } from '~/tools/executor';
export { DelegateTool } from '~/tools/implementations/delegate';
export { EventApprovalCallback } from '~/tools/event-approval-callback';
export { Session } from '~/sessions/session';
export { Project } from '~/projects/project';
export { ThreadManager } from '~/threads/thread-manager';

// Tool types
export type { ToolResult, ToolCall, ToolContext, ToolAnnotations } from '~/tools/types';

// Provider types
export type { CatalogProvider, ProviderInstancesConfig } from '~/providers/catalog/types';
export { ProviderInstanceSchema, CredentialSchema } from '~/providers/catalog/types';
export type { ConfiguredInstance } from '~/providers/registry';
export type { AIProvider } from '~/providers/base-provider';

// Tool implementations
export { FileReadTool } from '~/tools/implementations/file-read';
export type { Tool } from '~/tools/tool';

// Test utilities
export {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '~/test-utils/provider-instances';
export {
  setupTestProviderDefaults,
  cleanupTestProviderDefaults,
} from '~/test-utils/provider-defaults';
export { TestProvider } from '~/test-utils/test-provider';
export { ApprovalPendingError, ApprovalDecision } from '~/tools/approval-types';

// Database
export { getPersistence } from '~/persistence/database';
