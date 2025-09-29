// ABOUTME: Context analyzer that breaks down token usage by category
// ABOUTME: Analyzes thread events and agent state to calculate context breakdown

import type { ThreadId } from '~/threads/types';
import type { Agent } from '~/agents/agent';
import type { ContextBreakdown, CategoryDetail, ItemDetail } from './context-breakdown-types';
import { estimateTokens } from '~/utils/token-estimation';

export class ContextAnalyzer {
  /**
   * Analyzes an agent's thread and returns detailed context breakdown
   */
  static async analyze(threadId: ThreadId, agent: Agent): Promise<ContextBreakdown> {
    const systemPromptTokens = await this.countSystemPromptTokens(threadId, agent);
    const { core, mcp } = await this.countToolTokens(agent);

    // Get context limit from agent's provider
    const modelId = agent.model;
    let contextLimit = 200000; // Default fallback

    if (modelId && modelId !== 'unknown-model' && agent.providerInstance) {
      const models = agent.providerInstance.getAvailableModels();
      const modelInfo = models.find((m) => m.id === modelId);
      if (modelInfo) {
        contextLimit = modelInfo.contextWindow;
      }
    }

    const totalUsed = systemPromptTokens + core.tokens + mcp.tokens;

    // Return minimal valid response for now
    return {
      timestamp: new Date().toISOString(),
      modelId: agent.model,
      contextLimit,
      totalUsedTokens: totalUsed,
      percentUsed: totalUsed / contextLimit,
      categories: {
        systemPrompt: { tokens: systemPromptTokens },
        coreTools: core,
        mcpTools: mcp,
        messages: {
          tokens: 0,
          subcategories: {
            userMessages: { tokens: 0 },
            agentMessages: { tokens: 0 },
            toolCalls: { tokens: 0 },
            toolResults: { tokens: 0 },
          },
        },
        reservedForResponse: { tokens: 0 },
        freeSpace: { tokens: contextLimit - totalUsed },
      },
    };
  }

  private static async countSystemPromptTokens(threadId: ThreadId, agent: Agent): Promise<number> {
    // Get thread manager from agent
    const threadManager = agent.threadManager;

    // Get all events from thread
    const events = threadManager.getEvents(threadId);

    // Filter for SYSTEM_PROMPT and USER_SYSTEM_PROMPT events
    const systemEvents = events.filter(
      (e) => e.type === 'SYSTEM_PROMPT' || e.type === 'USER_SYSTEM_PROMPT'
    );

    // Extract content and count tokens
    let totalTokens = 0;
    for (const event of systemEvents) {
      if (typeof event.data === 'string') {
        totalTokens += estimateTokens(event.data);
      }
    }

    return totalTokens;
  }

  private static async countToolTokens(
    agent: Agent
  ): Promise<{ core: CategoryDetail; mcp: CategoryDetail }> {
    // Get tool executor from agent
    const toolExecutor = agent.toolExecutor;

    // Get all registered tools
    const allTools = toolExecutor.getAllTools();

    const coreToolItems: ItemDetail[] = [];
    const mcpToolItems: ItemDetail[] = [];
    let coreTotal = 0;
    let mcpTotal = 0;

    // Iterate tools and categorize
    for (const tool of allTools) {
      // Convert tool to JSON schema format
      const toolSchema = {
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      };
      const toolTokens = estimateTokens(JSON.stringify(toolSchema));

      const item: ItemDetail = {
        name: tool.name,
        tokens: toolTokens,
      };

      // MCP tools have "/" in their name (e.g., "server/tool")
      if (tool.name.includes('/')) {
        mcpToolItems.push(item);
        mcpTotal += toolTokens;
      } else {
        coreToolItems.push(item);
        coreTotal += toolTokens;
      }
    }

    return {
      core: { tokens: coreTotal, items: coreToolItems },
      mcp: { tokens: mcpTotal, items: mcpToolItems },
    };
  }
}
