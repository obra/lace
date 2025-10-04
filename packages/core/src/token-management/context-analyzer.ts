// ABOUTME: Context analyzer that breaks down token usage by category
// ABOUTME: Analyzes thread events and agent state to calculate context breakdown

import type { ThreadId } from '@lace/core/threads/types';
import type { Agent } from '@lace/core/agents/agent';
import type {
  ContextBreakdown,
  CategoryDetail,
  ItemDetail,
  MessageCategoryDetail,
} from './context-breakdown-types';
import { estimateTokens } from '@lace/core/utils/token-estimation';
import { MCPToolAdapter } from '@lace/core/mcp/tool-adapter';
import { logger } from '@lace/core/utils/logger';

export class ContextAnalyzer {
  /**
   * Analyzes an agent's thread and returns detailed context breakdown
   */
  static async analyze(threadId: ThreadId, agent: Agent): Promise<ContextBreakdown> {
    // Get the conversation and tools that would be sent to the API
    const conversation = agent.buildThreadMessages();
    const tools = agent.toolExecutor.getAllTools();
    const modelId = agent.model;

    logger.debug('[ContextAnalyzer] Starting analysis', {
      threadId,
      modelId,
      hasProvider: !!agent.providerInstance,
      toolCount: tools.length,
      messageCount: conversation.length,
    });

    // Try to use calibration if provider is available
    let calibration:
      | {
          systemTokens: number;
          toolTokens: number;
          toolDetails: Array<{ name: string; tokens: number }>;
        }
      | null
      | undefined = null;
    let actualPromptTokens: number | null = null;

    if (modelId && modelId !== 'unknown-model' && agent.providerInstance) {
      // Get the last AGENT_MESSAGE event to extract real usage from last API call
      const threadManager = agent.threadManager;
      const events = threadManager.getEvents(threadId);
      const lastAgentMessage = [...events]
        .reverse()
        .find((e) => e.type === 'AGENT_MESSAGE' && typeof e.data === 'object' && e.data !== null);

      logger.debug('[ContextAnalyzer] Looking for last AGENT_MESSAGE', {
        foundMessage: !!lastAgentMessage,
        totalEvents: events.length,
      });

      if (
        lastAgentMessage &&
        typeof lastAgentMessage.data === 'object' &&
        lastAgentMessage.data !== null &&
        'tokenUsage' in lastAgentMessage.data
      ) {
        const tokenUsage = lastAgentMessage.data.tokenUsage as {
          turn?: { inputTokens?: number; outputTokens?: number };
          context?: { currentTokens?: number };
        };

        // Try new format first (context.currentTokens)
        if (tokenUsage.context?.currentTokens) {
          actualPromptTokens = tokenUsage.context.currentTokens;

          logger.debug('[ContextAnalyzer] Extracted from context field', {
            actualPromptTokens,
          });
        } else if (
          tokenUsage.turn?.inputTokens !== undefined &&
          tokenUsage.turn?.outputTokens !== undefined
        ) {
          // Fallback: calculate from turn data
          actualPromptTokens = tokenUsage.turn.inputTokens + tokenUsage.turn.outputTokens;

          logger.debug('[ContextAnalyzer] Calculated from turn fields', {
            inputTokens: tokenUsage.turn.inputTokens,
            outputTokens: tokenUsage.turn.outputTokens,
            actualPromptTokens,
          });
        }
      }

      // Calibrate system and tool costs via provider
      if (agent.providerInstance.calibrateTokenCosts) {
        logger.debug('[ContextAnalyzer] Starting calibration', {
          provider: agent.providerInstance.providerName,
          toolCount: tools.length,
        });

        calibration = await agent.providerInstance.calibrateTokenCosts(
          conversation,
          tools,
          modelId
        );

        logger.debug('[ContextAnalyzer] Calibration complete', {
          hasCalibration: !!calibration,
          systemTokens: calibration?.systemTokens,
          toolTokens: calibration?.toolTokens,
          toolDetailsCount: calibration?.toolDetails?.length,
        });
      } else {
        logger.debug('[ContextAnalyzer] Provider does not support calibration');
      }
    }

    let systemTokens: number;
    let coreToolsData: CategoryDetail;
    let mcpToolsData: CategoryDetail;
    let messagesData: MessageCategoryDetail;

    if (calibration && actualPromptTokens !== null) {
      logger.debug('[ContextAnalyzer] Using CALIBRATION path', {
        actualPromptTokens,
        systemTokens: calibration.systemTokens,
        toolTokens: calibration.toolTokens,
      });

      // Use accurate calibration + real usage
      systemTokens = calibration.systemTokens;

      // Separate tools into core vs MCP
      const coreTools: ItemDetail[] = [];
      const mcpTools: ItemDetail[] = [];
      let coreTotal = 0;
      let mcpTotal = 0;

      for (const toolDetail of calibration.toolDetails) {
        const tool = tools.find((t) => t.name === toolDetail.name);
        if (tool instanceof MCPToolAdapter) {
          mcpTools.push(toolDetail);
          mcpTotal += toolDetail.tokens;
        } else {
          coreTools.push(toolDetail);
          coreTotal += toolDetail.tokens;
        }
      }

      coreToolsData = { tokens: coreTotal, items: coreTools };
      mcpToolsData = { tokens: mcpTotal, items: mcpTools };

      // Calculate message tokens by subtraction from actual usage
      const messageTokens = Math.max(0, actualPromptTokens - systemTokens - calibration.toolTokens);

      logger.debug('[ContextAnalyzer] Calculated message tokens by subtraction', {
        messageTokens,
        calculation: `${actualPromptTokens} - ${systemTokens} - ${calibration.toolTokens}`,
      });

      // Still estimate subcategories from events for breakdown
      const estimatedBreakdown = this.countMessageTokens(threadId, agent);

      messagesData = {
        tokens: messageTokens, // Accurate total from calibration
        subcategories: estimatedBreakdown.subcategories, // Estimated proportions
      };
    } else {
      logger.debug('[ContextAnalyzer] Using ESTIMATION fallback path', {
        hasCalibration: !!calibration,
        hasActualPromptTokens: actualPromptTokens !== null,
      });

      // Fallback to estimation-based approach
      systemTokens = this.countSystemPromptTokens(threadId, agent);
      const toolData = this.countToolTokens(agent);
      coreToolsData = toolData.core;
      mcpToolsData = toolData.mcp;
      messagesData = this.countMessageTokens(threadId, agent);
    }

    // Get context limit from agent's provider
    const DEFAULT_CONTEXT_LIMIT = 200000;
    let contextLimit = DEFAULT_CONTEXT_LIMIT;

    if (agent.providerInstance) {
      try {
        const models = agent.providerInstance.getAvailableModels();
        const modelInfo = models.find((m) => m.id === modelId);
        if (modelInfo?.contextWindow) {
          contextLimit = modelInfo.contextWindow;
        }
      } catch (error) {
        logger.warn(`Failed to retrieve context limit for model ${modelId}:`, {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const reservedTokens = this.getReservedTokens(agent);
    const totalUsed =
      systemTokens + coreToolsData.tokens + mcpToolsData.tokens + messagesData.tokens;
    const freeTokens = contextLimit - totalUsed - reservedTokens;

    return {
      timestamp: new Date().toISOString(),
      modelId: agent.model,
      contextLimit,
      totalUsedTokens: totalUsed,
      percentUsed: totalUsed / contextLimit,
      categories: {
        systemPrompt: { tokens: systemTokens },
        coreTools: coreToolsData,
        mcpTools: mcpToolsData,
        messages: messagesData,
        reservedForResponse: { tokens: reservedTokens },
        freeSpace: { tokens: Math.max(0, freeTokens) },
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
