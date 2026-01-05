// ABOUTME: Shared types used by both agent and web packages
// ABOUTME: These are application-level types (not wire protocol types)

// ==================
// Tool Types
// ==================

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  safeInternal?: boolean;
  readOnlySafe?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ContentBlock {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;
  uri?: string;
}

export type ToolResultStatus = 'completed' | 'failed' | 'aborted' | 'denied' | 'pending';

export interface ToolResult {
  id?: string;
  content: ContentBlock[];
  status: ToolResultStatus;
  metadata?: Record<string, unknown>;
  tokenUsage?: CombinedTokenUsage;
}

export type ToolPolicy = 'allow' | 'ask' | 'deny' | 'disable';

export enum ApprovalDecision {
  ALLOW_ONCE = 'allow_once',
  ALLOW_SESSION = 'allow_session',
  ALLOW_PROJECT = 'allow_project',
  ALLOW_ALWAYS = 'allow_always',
  DENY = 'deny',
  DISABLE = 'disable',
}

// ==================
// Provider Types
// ==================

export interface ProviderInfo {
  name: string;
  displayName: string;
  requiresApiKey: boolean;
  configurationHint?: string;
}

export interface ProviderResponse {
  content: string;
  toolCalls: ToolCall[];
  stopReason?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  performance?: {
    tokensPerSecond?: number;
    timeToFirstToken?: number;
    totalDuration?: number;
  };
  responseId?: string;
}

export interface ModelInfo {
  id: string;
  displayName: string;
  description?: string;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities?: string[];
  isDefault?: boolean;
}

// ==================
// Token Management Types
// ==================

interface TurnTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ThreadTokenUsage {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  contextLimit: number;
  percentUsed: number;
  nearLimit: boolean;
}

export interface TokenUsageMetrics {
  turn?: TurnTokenUsage;
  context: ThreadTokenUsage;
}

export type CombinedTokenUsage = TokenUsageMetrics;

// ==================
// Context Breakdown Types
// ==================

export interface ItemDetail {
  name: string;
  tokens: number;
}

export interface CategoryDetail {
  tokens: number;
  items?: ItemDetail[];
}

export interface MessageCategoryDetail extends CategoryDetail {
  subcategories: {
    userMessages: { tokens: number };
    agentMessages: { tokens: number };
    toolCalls: { tokens: number };
    toolResults: { tokens: number };
  };
}

export interface ContextBreakdown {
  timestamp: string;
  modelId: string;
  contextLimit: number;
  totalUsedTokens: number;
  percentUsed: number;
  categories: {
    systemPrompt: CategoryDetail;
    coreTools: CategoryDetail;
    mcpTools: CategoryDetail;
    messages: MessageCategoryDetail;
    reservedForResponse: CategoryDetail;
    freeSpace: CategoryDetail;
  };
}

// ==================
// Project Types
// ==================

export interface ProjectInfo {
  id: string;
  name: string;
  description: string;
  workingDirectory: string;
  isArchived: boolean;
  createdAt: Date;
  lastUsedAt: Date;
  sessionCount?: number;
}

// ==================
// MCP Types
// ==================

export interface DiscoveredTool {
  name: string;
  description?: string;
}

export interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
  tools: Record<string, ToolPolicy>;
  discoveredTools?: DiscoveredTool[];
  lastDiscovery?: string;
  discoveryError?: string;
  discoveryStatus?: 'never' | 'discovering' | 'success' | 'failed';
}

export interface MCPConfig {
  servers: Record<string, MCPServerConfig>;
}

// ==================
// Compaction Types
// ==================

export interface CompactionData {
  strategyId: string;
  originalEventCount: number;
  compactedEventCount: number;
  metadata?: Record<string, unknown>;
}

// ==================
// Persona Types
// ==================

export interface PersonaInfo {
  name: string;
  isUserDefined: boolean;
  path: string;
}

// ==================
// Workspace Types
// ==================

export interface WorkspaceInfo {
  sessionId: string;
  projectDir: string;
  clonePath: string;
  containerId: string;
  state: string;
  containerMountPath?: string;
  branchName?: string;
}

// ==================
// File Edit Types
// ==================

export interface FileEditDiffContext {
  beforeContext: string;
  afterContext: string;
  oldContent: string;
  newContent: string;
  startLine: number;
}
