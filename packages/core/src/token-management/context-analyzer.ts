// ABOUTME: Context analyzer that breaks down token usage by category
// ABOUTME: Analyzes thread events and agent state to calculate context breakdown

import type { ThreadId } from '~/threads/types';
import type { Agent } from '~/agents/agent';
import type { ContextBreakdown } from './context-breakdown-types';
import { estimateTokens } from '~/utils/token-estimation';

export class ContextAnalyzer {
  /**
   * Analyzes an agent's thread and returns detailed context breakdown
   */
  static async analyze(threadId: ThreadId, agent: Agent): Promise<ContextBreakdown> {
    const systemPromptTokens = await this.countSystemPromptTokens(threadId, agent);

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

    // Return minimal valid response for now
    return {
      timestamp: new Date().toISOString(),
      modelId: agent.model,
      contextLimit,
      totalUsedTokens: systemPromptTokens,
      percentUsed: systemPromptTokens / contextLimit,
      categories: {
        systemPrompt: { tokens: systemPromptTokens },
        coreTools: { tokens: 0, items: [] },
        mcpTools: { tokens: 0, items: [] },
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
        freeSpace: { tokens: contextLimit - systemPromptTokens },
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
}
