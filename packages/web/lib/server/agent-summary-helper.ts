// ABOUTME: Helper for generating agent summaries using SessionHelper
// ABOUTME: Called after user messages to create real-time activity summaries

import { SessionHelper } from '@/lib/server/lace-imports';
import type { Agent } from '@/lib/server/lace-imports';
import type { LaceEvent } from '@/types/core';

class SummaryHelperError extends Error {
  public readonly code: string;
  public readonly helperName: string;
  public readonly originalResult?: unknown;

  constructor(code: string, message: string, context?: { originalResult?: unknown }) {
    super(message);
    this.name = 'SummaryHelperError';
    this.code = code;
    this.helperName = 'SessionHelper';
    this.originalResult = context?.originalResult;
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
      persona: 'session-summary', // Use our minimal summary persona
    });

    // Build simplified context for the persona
    let context = `User message: "${userMessage}"`;
    if (lastAgentResponse) {
      context += `\n\nAgent's last response: "${lastAgentResponse}"`;
    }

    // Simplified prompt - let the persona handle the behavior guidelines
    const prompt = `Based on this conversation context, generate a one-sentence summary of what the agent is currently working on:

${context}`;

    const result = await helper.execute(prompt);

    if (result?.content && typeof result.content === 'string' && result.content.trim()) {
      return result.content.trim();
    } else {
      throw new SummaryHelperError('NO_SUMMARY', 'No summary content returned from helper', {
        originalResult: result,
      });
    }
  } catch (error: unknown) {
    if (error instanceof SummaryHelperError) {
      throw error;
    }
    throw new SummaryHelperError('EXECUTION_FAILED', 'Agent summary helper execution failed');
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
