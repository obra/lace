// ABOUTME: Server-side imports for Lace core modules - BUSINESS LOGIC CLASSES ONLY
// ABOUTME: Uses ~ path aliases to reference main project source

// Business logic classes - should only be used by service layer
// Import from @lace/agent where available (providers, tools, helpers)
export { ProviderRegistry } from '@lace/agent/providers/registry';
export { ProviderCatalogManager } from '@lace/agent/providers/catalog/manager';
export { ProviderInstanceManager } from '@lace/agent/providers/instance/manager';
export { ToolExecutor } from '@lace/agent/tools/executor';
export { ToolCatalog } from '@lace/agent/tools/tool-catalog';
export { Project } from '@lace/agent/projects/project';
export { InfrastructureHelper } from '@lace/agent/helpers/infrastructure-helper';

// Provider types - import from agent since InfrastructureHelper uses agent's AIProvider
export type { AIProvider } from '@lace/agent/providers/base-provider';

// Provider catalog types from agent
export type {
  CatalogProvider,
  CatalogModel,
  ProviderInstancesConfig,
  ModelConfig,
} from '@lace/agent/providers/catalog/types';
export {
  ProviderInstanceSchema,
  CredentialSchema,
  ModelConfigSchema,
} from '@lace/agent/providers/catalog/types';
export type { ConfiguredInstance } from '@lace/agent/providers/registry';

// OpenRouter dynamic provider from agent
export { OpenRouterDynamicProvider } from '@lace/agent/providers/openrouter/dynamic-provider';

// Tool implementations from agent
export { FileReadTool } from '@lace/agent/tools/implementations/file_read';

// Test utilities - still in core (not yet moved to agent)
export {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '@lace/core/test-utils/provider-instances';
export {
  setupTestProviderDefaults,
  cleanupTestProviderDefaults,
} from '@lace/core/test-utils/provider-defaults';
// TestProvider is in agent
export { TestProvider } from '@lace/agent/test-utils/test-provider';
// Tool types from agent
export { ApprovalPendingError, ApprovalDecision } from '@lace/agent/tools/types';

// Database and configuration from agent
export { ensureLaceDir } from '@lace/agent/config/lace-dir';
export { UserSettingsManager } from '@lace/agent/config/user-settings';
export { MCPConfigLoader } from '@lace/agent/config/mcp-config-loader';
export { PromptManager } from '@lace/agent/config/prompt-manager';
export { personaRegistry } from '@lace/agent/config/persona-registry';
export type { PersonaInfo } from '@lace/agent/config/persona-registry';
