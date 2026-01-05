// ABOUTME: Server-side imports for Lace core modules - BUSINESS LOGIC CLASSES ONLY
// ABOUTME: Uses ~ path aliases to reference main project source

// Business logic classes - should only be used by service layer
export { ProviderRegistry } from '@lace/core/providers/registry';
export { ProviderCatalogManager } from '@lace/core/providers/catalog/manager';
export { ProviderInstanceManager } from '@lace/core/providers/instance/manager';
export { ToolExecutor } from '@lace/core/tools/executor';
export { ToolCatalog } from '@lace/core/tools/tool-catalog';
export { Project } from '@lace/core/projects/project';
export { InfrastructureHelper } from '@lace/agent/helpers/infrastructure-helper';

// Provider types
export type { AIProvider } from '@lace/core/providers/base-provider';

// Tool types

// Provider types
export type {
  CatalogProvider,
  CatalogModel,
  ProviderInstancesConfig,
  ModelConfig,
} from '@lace/core/providers/catalog/types';
export {
  ProviderInstanceSchema,
  CredentialSchema,
  ModelConfigSchema,
} from '@lace/core/providers/catalog/types';
export type { ConfiguredInstance } from '@lace/core/providers/registry';

// OpenRouter dynamic provider
export { OpenRouterDynamicProvider } from '@lace/core/providers/openrouter/dynamic-provider';

// Tool implementations
export { FileReadTool } from '@lace/core/tools/implementations/file_read';

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
export { ApprovalPendingError, ApprovalDecision } from '@lace/core/tools/types';

// Database and configuration
export { ensureLaceDir } from '@lace/core/config/lace-dir';
export { UserSettingsManager } from '@lace/core/config/user-settings';
export { MCPConfigLoader } from '@lace/core/config/mcp-config-loader';
export { PromptManager } from '@lace/core/config/prompt-manager';
export { personaRegistry } from '@lace/core/config/persona-registry';
export type { PersonaInfo } from '@lace/core/config/persona-registry';
