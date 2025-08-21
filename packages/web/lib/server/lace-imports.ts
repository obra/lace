// ABOUTME: Server-side imports for Lace core modules - BUSINESS LOGIC CLASSES ONLY
// ABOUTME: Facade for core package imports, maintains clean abstraction boundaries

import 'server-only';

// Business logic classes - should only be used by service layer
export { Agent } from '@lace/core/agents/agent';
export { ProviderRegistry } from '@lace/core/providers/registry';
export { ProviderCatalogManager } from '@lace/core/providers/catalog/manager';
export { ProviderInstanceManager } from '@lace/core/providers/instance/manager';
export { ToolExecutor } from '@lace/core/tools/executor';
export { EventApprovalCallback } from '@lace/core/tools/event-approval-callback';
export { Session } from '@lace/core/sessions/session';
export { Project } from '@lace/core/projects/project';
export { ThreadManager } from '@lace/core/threads/thread-manager';

// Tool types

// Provider types
export type { CatalogProvider, ProviderInstancesConfig } from '@lace/core/providers/catalog/types';
export { ProviderInstanceSchema, CredentialSchema } from '@lace/core/providers/catalog/types';
export type { ConfiguredInstance } from '@lace/core/providers/registry';

// Tool implementations
export { FileReadTool } from '@lace/core/tools/implementations/file-read';

// Test utilities
export {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '@lace/core/test-utils/provider-instances';
export {
  setupTestProviderDefaults,
  cleanupTestProviderDefaults,
} from '@lace/core/test-utils/provider-defaults';
export { TestProvider } from '@lace/core/test-utils/test-provider';
export { ApprovalPendingError, ApprovalDecision } from '@lace/core/tools/approval-types';

// Database and configuration
export { ensureLaceDir } from '@lace/core/config/lace-dir';

// Utilities
export { logger } from '@lace/core/utils/logger';
