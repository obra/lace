// ABOUTME: Server-side imports for Lace core modules - BUSINESS LOGIC CLASSES ONLY
// ABOUTME: Uses ~ path aliases to reference main project source

// Business logic classes - should only be used by service layer
export { Agent } from '~/agents/agent';
export { ProviderRegistry } from '~/providers/registry';
export { ProviderCatalogManager } from '~/providers/catalog/manager';
export { ProviderInstanceManager } from '~/providers/instance/manager';
export { ToolExecutor } from '~/tools/executor';
export { EventApprovalCallback } from '~/tools/event-approval-callback';
export { Session } from '~/sessions/session';
export { Project } from '~/projects/project';
export { ThreadManager } from '~/threads/thread-manager';
export { SessionHelper } from '~/helpers/session-helper';

// Tool types

// Provider types
export type { CatalogProvider, ProviderInstancesConfig } from '~/providers/catalog/types';
export { ProviderInstanceSchema, CredentialSchema } from '~/providers/catalog/types';
export type { ConfiguredInstance } from '~/providers/registry';

// Tool implementations
export { FileReadTool } from '~/tools/implementations/file-read';

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

// Database and configuration
export { ensureLaceDir } from '~/config/lace-dir';
export { UserSettingsManager } from '~/config/user-settings';
export { MCPConfigLoader } from '~/config/mcp-config-loader';
