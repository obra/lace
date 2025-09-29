// ABOUTME: Context analyzer that breaks down token usage by category
// ABOUTME: Analyzes thread events and agent state to calculate context breakdown

import type { ThreadId } from '~/threads/types';
import type { Agent } from '~/agents/agent';
import type {
  ContextBreakdown,
  CategoryDetail,
  ItemDetail,
  MessageCategoryDetail,
} from '~/token-management/context-breakdown-types';
import { estimateTokens } from '~/utils/token-estimation';
import { MCPToolAdapter } from '~/mcp/tool-adapter';

export class ContextAnalyzer {
  /**
   * Analyzes an agent's thread and returns detailed context breakdown
   */
  static async analyze(threadId: ThreadId, agent: Agent): Promise<ContextBreakdown> {
    const systemPromptTokens = await Promise.resolve(this.countSystemPromptTokens(threadId, agent));
    const { core, mcp } = this.countToolTokens(agent);
    const messages = this.countMessageTokens(threadId, agent);

    // Get context limit from agent's provider
    const modelId = agent.model;
    const DEFAULT_CONTEXT_LIMIT = 200000; // Default fallback for unknown models
    let contextLimit = DEFAULT_CONTEXT_LIMIT;

    if (modelId && modelId !== 'unknown-model' && agent.providerInstance) {
      try {
        const models = agent.providerInstance.getAvailableModels();
        const modelInfo = models.find((m) => m.id === modelId);
        if (modelInfo?.contextWindow) {
          contextLimit = modelInfo.contextWindow;
        }
      } catch (error) {
        // Log warning but continue with default - don't fail the analysis
        console.warn(
          `Failed to retrieve context limit for model ${modelId}:`,
          error instanceof Error ? error.message : 'Unknown error'
        );
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

  /**
   * Gets the number of tokens to reserve for the agent's response.
   *
   * Reserves 4096 tokens by default, which provides:
   * - Enough space for meaningful responses (typically 500-1000 words)
   * - Headroom for tool calls and structured output
   * - Balance between context usage and response quality
   *
   * This value works well across different model sizes:
   * - Small models (8k context): ~50% reserved for response
   * - Medium models (128k context): ~3% reserved
   * - Large models (200k+ context): ~2% reserved
   *
   * @param _agent The agent instance (currently unused, reserved for future per-agent configuration)
   * @returns Number of tokens to reserve for the response
   */
  private static getReservedTokens(_agent: Agent): number {
    return 4096;
  }

  private static countSystemPromptTokens(threadId: ThreadId, agent: Agent): number {
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

  private static countToolTokens(agent: Agent): { core: CategoryDetail; mcp: CategoryDetail } {
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

      // Check if tool is an MCP tool using instanceof
      if (tool instanceof MCPToolAdapter) {
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

  private static countMessageTokens(threadId: ThreadId, agent: Agent): MessageCategoryDetail {
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
