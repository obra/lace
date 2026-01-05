// ABOUTME: Type definitions for context breakdown feature
// ABOUTME: Interfaces for categorizing and reporting token usage

export interface ItemDetail {
  name: string; // e.g., "bash", "deepwiki__read_wiki_structure"
  tokens: number;
}

export interface CategoryDetail {
  tokens: number;
  items?: ItemDetail[]; // Optional drill-down
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
  timestamp: string; // ISO timestamp of snapshot
  modelId: string; // e.g., "claude-sonnet-4-5"
  contextLimit: number; // e.g., 200000
  totalUsedTokens: number; // Sum of all categories except free space
  percentUsed: number; // 0-1 decimal

  categories: {
    systemPrompt: CategoryDetail;
    coreTools: CategoryDetail;
    mcpTools: CategoryDetail;
    messages: MessageCategoryDetail;
    reservedForResponse: CategoryDetail;
    freeSpace: CategoryDetail;
  };
}
