// ABOUTME: Helper for generating agent summaries using SessionHelper
// ABOUTME: Called after user messages to create real-time activity summaries

import { SessionHelper } from '~/helpers/session-helper';
import { logger } from '~/utils/logger';
import type { Agent } from '@/lib/server/lace-imports';
import type { LaceEvent } from '@/types/core';

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
    logger.debug('Creating SessionHelper for agent summary', {
      agentId: getAgentId(agent),
      hasAgent: !!agent,
      userMessage,
      hasLastResponse: !!lastAgentResponse,
    });

    // SessionHelper will try 'fast' model from global config, fall back to agent's provider
    const helper = new SessionHelper({
      model: 'fast',
      parentAgent: agent,
    });

    logger.debug('SessionHelper created successfully', {
      agentId: getAgentId(agent),
    });

    // Build context for the summary
    let context = `User message: "${userMessage}"`;
    if (lastAgentResponse) {
      context += `\n\nAgent's last response: "${lastAgentResponse}"`;
    }

    const prompt = `Based on this conversation context, put together a clear one-sentence summary of what the agent is currently working on. It should be casual and sometimes a little playful, like you're talking to someone you trust. This will be shown at the top of the chat window.

${context}

Respond with just the summary sentence, nothing else. Keep it concise and focused on the current task or activity.`;

    logger.debug('Executing SessionHelper with prompt', {
      agentId: getAgentId(agent),
      promptLength: prompt.length,
    });

    const result = await helper.execute(prompt);

    logger.debug('SessionHelper execution result', {
      agentId: getAgentId(agent),
      hasContent: !!result.content,
      contentLength: result.content?.length || 0,
      toolCallsCount: result.toolCalls?.length || 0,
    });

    if (result.content && result.content.trim()) {
      const summary = result.content.trim();
      logger.debug('Agent summary generated successfully', {
        agentId: getAgentId(agent),
        summary,
      });
      return summary;
    } else {
      logger.warn('Agent summary generation failed - no content returned', {
        agentId: getAgentId(agent),
        result: result,
      });
      return 'Processing your request';
    }
  } catch (error) {
    logger.error('Agent summary helper error', {
      agentId: getAgentId(agent),
      error: error instanceof Error ? error.message : String(error),
    });
    return 'Processing your request';
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
    if (event.type === 'AGENT_MESSAGE' && typeof event.data === 'string') {
      return event.data;
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
