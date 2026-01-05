export * from './transport/stdio';
export * from './transport/types';
export * from './rpc/peer';
export * from './ids';
export * from './errors';
export * from './schemas';

// Re-export application types that don't conflict with schema types
// Note: types/shared.ts has application-level types, schemas/shared.ts has wire protocol types
// Conflicting types (ContentBlock, ModelInfo, ProviderInfo, ToolResult) are NOT re-exported here
// Web should import from '@lace/ent-protocol/types/shared' for application types
export {
  // Tool types (non-conflicting)
  ToolAnnotations,
  ToolCall,
  ToolResultStatus,
  ToolPolicy,
  ApprovalDecision,
  // Token types
  ThreadTokenUsage,
  TokenUsageMetrics,
  CombinedTokenUsage,
  // Context breakdown types
  ItemDetail,
  CategoryDetail,
  MessageCategoryDetail,
  ContextBreakdown,
  // Project types
  ProjectInfo,
  // MCP types (use MCPServerConfig from types, not McpServerConfig from schemas)
  DiscoveredTool,
  MCPConfig,
  // Compaction types
  CompactionData,
  // Persona types
  PersonaInfo,
  // Workspace types
  WorkspaceInfo,
  // File edit types
  FileEditDiffContext,
} from './types/shared';

// Explicitly re-export application-level types that have different
// shapes than the wire protocol types (for cases where web needs them)
export type {
  ContentBlock as AppContentBlock,
  ToolResult as AppToolResult,
  ModelInfo as AppModelInfo,
  ProviderInfo as AppProviderInfo,
  ProviderResponse as AppProviderResponse,
  MCPServerConfig as AppMCPServerConfig,
} from './types/shared';
