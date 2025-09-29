// ABOUTME: Context analyzer that breaks down token usage by category
// ABOUTME: Analyzes thread events and agent state to calculate context breakdown

import type { ThreadId } from '~/threads/types';
import type { Agent } from '~/agents/agent';
import type {
  ContextBreakdown,
  CategoryDetail,
  ItemDetail,
  MessageCategoryDetail,
} from './context-breakdown-types';
import { estimateTokens } from '~/utils/token-estimation';

export class ContextAnalyzer {
  /**
   * Analyzes an agent's thread and returns detailed context breakdown
   */
  static async analyze(threadId: ThreadId, agent: Agent): Promise<ContextBreakdown> {
    const systemPromptTokens = await this.countSystemPromptTokens(threadId, agent);
    const { core, mcp } = await this.countToolTokens(agent);
    const messages = await this.countMessageTokens(threadId, agent);

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

    const reservedTokens = this.getReservedTokens(agent);
    const totalUsed = systemPromptTokens + core.tokens + mcp.tokens + messages.tokens;
    const freeTokens = contextLimit - totalUsed - reservedTokens;

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
        messages,
        reservedForResponse: { tokens: reservedTokens },
        freeSpace: { tokens: Math.max(0, freeTokens) }, // Don't go negative
      },
    };
  }

  private static getReservedTokens(_agent: Agent): number {
    // Reserve space for agent response
    // Default to 4096 tokens (reasonable for most models)
    // This could be made configurable in the future based on agent settings
    return 4096;
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

  private static async countMessageTokens(
    threadId: ThreadId,
    agent: Agent
  ): Promise<MessageCategoryDetail> {
    const threadManager = agent.threadManager;
    const events = threadManager.getEvents(threadId);

    let userTokens = 0;
    let agentTokens = 0;
    let toolCallTokens = 0;
    let toolResultTokens = 0;

    for (const event of events) {
      switch (event.type) {
        case 'USER_MESSAGE':
          if (typeof event.data === 'string') {
            userTokens += estimateTokens(event.data);
          }
          break;

        case 'AGENT_MESSAGE':
          if (event.data && typeof event.data === 'object' && 'content' in event.data) {
            const agentData = event.data as { content: string };
            agentTokens += estimateTokens(agentData.content);
          }
          break;

        case 'TOOL_CALL':
          // Tool calls include name + arguments
          if (event.data && typeof event.data === 'object') {
            const toolData = JSON.stringify(event.data);
            toolCallTokens += estimateTokens(toolData);
          }
          break;

        case 'TOOL_RESULT':
          // Tool results include content blocks
          if (event.data && typeof event.data === 'object' && 'content' in event.data) {
            const resultData = event.data as { content: Array<{ text?: string }> };
            if (Array.isArray(resultData.content)) {
              for (const block of resultData.content) {
                if (block.text) {
                  toolResultTokens += estimateTokens(block.text);
                }
              }
            }
          }
          break;
      }
    }

    const totalMessageTokens = userTokens + agentTokens + toolCallTokens + toolResultTokens;

    return {
      tokens: totalMessageTokens,
      subcategories: {
        userMessages: { tokens: userTokens },
        agentMessages: { tokens: agentTokens },
        toolCalls: { tokens: toolCallTokens },
        toolResults: { tokens: toolResultTokens },
      },
    };
  }
}
