// ABOUTME: Enhanced conversation builder that preserves tool call semantics
// ABOUTME: Converts thread events to provider-agnostic format with proper tool call support

import { ProviderMessage, ProviderToolCall, ProviderToolResult } from '../providers/types.js';
import { ThreadEvent, ToolCallData, ToolResultData } from './types.js';

export function buildConversationFromEvents(events: ThreadEvent[]): ProviderMessage[] {
  const messages: ProviderMessage[] = [];

  // Track which events have been processed to avoid duplicates
  const processedEventIndices = new Set<number>();

  for (let i = 0; i < events.length; i++) {
    if (processedEventIndices.has(i)) {
      continue;
    }

    const event = events[i];
    if (event.type === 'USER_MESSAGE') {
      messages.push({
        role: 'user',
        content: event.data as string,
      });
    } else if (event.type === 'AGENT_MESSAGE') {
      // Look ahead to see if there are immediate tool calls after this message
      const toolCallsForThisMessage: ProviderToolCall[] = [];

      // Find tool calls that should be grouped with this agent message
      let nextIndex = i + 1;
      while (nextIndex < events.length) {
        const nextEvent = events[nextIndex];

        // If we hit another AGENT_MESSAGE or USER_MESSAGE, stop looking
        if (nextEvent.type === 'AGENT_MESSAGE' || nextEvent.type === 'USER_MESSAGE') {
          break;
        }

        // If we find a TOOL_CALL, it belongs to this agent message
        if (nextEvent.type === 'TOOL_CALL') {
          const toolCall = nextEvent.data as ToolCallData;
          toolCallsForThisMessage.push({
            id: toolCall.callId,
            name: toolCall.toolName,
            input: toolCall.input,
          });
          processedEventIndices.add(nextIndex); // Mark as processed
        }

        nextIndex++;
      }

      // Create the assistant message with tool calls if any
      const message: ProviderMessage = {
        role: 'assistant',
        content: event.data as string,
      };

      if (toolCallsForThisMessage.length > 0) {
        message.toolCalls = toolCallsForThisMessage;
      }

      messages.push(message);
    } else if (event.type === 'TOOL_CALL') {
      // If we reach here, it's an orphaned tool call (no preceding AGENT_MESSAGE)
      const toolCall = event.data as ToolCallData;

      // Create an assistant message with just the tool call
      messages.push({
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: toolCall.callId,
            name: toolCall.toolName,
            input: toolCall.input,
          },
        ],
      });
    } else if (event.type === 'TOOL_RESULT') {
      const toolResult = event.data as ToolResultData;

      // Look ahead to see if there are more tool results to group together
      const toolResultsForThisMessage: ProviderToolResult[] = [];

      // Add this tool result
      toolResultsForThisMessage.push({
        id: toolResult.callId,
        output: toolResult.output || '',
        success: toolResult.success,
        error: toolResult.error,
      });

      // Look for consecutive tool results
      let nextIndex = i + 1;
      while (nextIndex < events.length) {
        const nextEvent = events[nextIndex];

        // If we hit a non-TOOL_RESULT event, stop looking
        if (nextEvent.type !== 'TOOL_RESULT') {
          break;
        }

        const nextToolResult = nextEvent.data as ToolResultData;
        toolResultsForThisMessage.push({
          id: nextToolResult.callId,
          output: nextToolResult.output || '',
          success: nextToolResult.success,
          error: nextToolResult.error,
        });

        processedEventIndices.add(nextIndex); // Mark as processed
        nextIndex++;
      }

      // Create user message with tool results
      messages.push({
        role: 'user',
        content: '', // No text content for pure tool results
        toolResults: toolResultsForThisMessage,
      });
    } else {
      throw new Error(`Unknown event type: ${event.type}`);
    }
  }

  return messages;
}
