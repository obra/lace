// ABOUTME: Helper for generating agent summaries using SessionHelper
// ABOUTME: Called after user messages to create real-time activity summaries

import { SessionHelper } from '@/lib/server/lace-imports';
import { logger } from '~/utils/logger';
import type { Agent } from '@/lib/server/lace-imports';
import type { LaceEvent } from '@/types/core';

class AgentSummaryError extends Error {
  public readonly code: string;
  public readonly agentId: string;
  public readonly cause?: Error;

  constructor(message: string, context: { agentId: string; code: string; cause?: unknown }) {
    super(message);
    this.name = 'AgentSummaryError';
    this.code = context.code;
    this.agentId = context.agentId;
    this.cause = context.cause instanceof Error ? context.cause : undefined;
  }
}

/**
 * Generate a one-sentence summary of what the agent is currently working on
 * @param agent The agent to generate summary for
 * @param userMessage The latest user message
 * @param lastAgentResponse The agent's last response (if any)
 * @returns Promise<string> The generated summary
 */
export async function generateAgentSummary(
  agent: Agent,
  userMessage: string,
  lastAgentResponse?: string
): Promise<string> {
  try {
    const helper = new SessionHelper({
      model: 'fast',
      parentAgent: agent,
    });

    // Build context for the summary
    let context = `User message: "${userMessage}"`;
    if (lastAgentResponse) {
      context += `\n\nAgent's last response: "${lastAgentResponse}"`;
    }

    const prompt = `Based on this conversation context, put together a clear one-sentence summary of what the agent is currently working on. It should be casual and sometimes a little playful, like you're talking to someone you trust. This will be shown at the top of the chat window.

${context}

Respond with just the summary sentence, nothing else. Keep it concise and focused on the current task or activity.`;

    const result = await helper.execute(prompt);

    if (result.content && result.content.trim()) {
      return result.content.trim();
    } else {
      const agentId = getAgentId(agent);
      throw new AgentSummaryError('No summary content returned from helper', {
        agentId,
        code: 'NO_CONTENT',
      });
    }
  } catch (error) {
    const agentId = getAgentId(agent);

    if (error instanceof AgentSummaryError) {
      // Already structured, just log and re-throw
      logger.error('Agent summary helper error', {
        agentId: error.agentId,
        code: error.code,
        message: error.message,
        stack: error.stack,
        cause: error.cause?.message,
      });
      throw error;
    }

    // Wrap other errors in structured format
    const wrappedError = new AgentSummaryError('Agent summary helper execution failed', {
      agentId,
      code: 'EXECUTION_FAILED',
      cause: error,
    });

    logger.error('Agent summary helper error', {
      agentId: wrappedError.agentId,
      code: wrappedError.code,
      message: wrappedError.message,
      stack: wrappedError.stack,
      cause: wrappedError.cause?.message,
    });

    throw wrappedError;
  }
}

/**
 * Extract the last agent message from thread events
 * @param events Thread events array
 * @returns The last agent message content or undefined
 */
export function getLastAgentResponse(events: LaceEvent[]): string | undefined {
  // Find the last AGENT_MESSAGE event
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === 'AGENT_MESSAGE' && event.data && typeof event.data === 'object') {
      // AGENT_MESSAGE.data is AgentMessageData { content: string }
      if ('content' in event.data) {
        const content = (event.data as { content: string }).content;
        return typeof content === 'string' ? content : undefined;
      }
    }
  }
  return undefined;
}

/**
 * Helper to safely get agent ID
 */
function getAgentId(agent: Agent): string {
  try {
    // Try to get the thread ID from agent
    if (agent && typeof agent === 'object' && 'threadId' in agent) {
      return String(agent.threadId);
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}
