// ABOUTME: Builds Anthropic conversation format from thread events
// ABOUTME: Handles proper grouping of messages, tool calls, and tool results

import Anthropic from '@anthropic-ai/sdk';
import { ThreadEvent, ToolCallData, ToolResultData } from './types.js';

export function buildConversationFromEvents(events: ThreadEvent[]): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [];

  let i = 0;
  while (i < events.length) {
    const event = events[i];

    if (event.type === 'USER_MESSAGE') {
      messages.push({ role: 'user', content: event.data as string });
      i++;
    } else if (event.type === 'AGENT_MESSAGE') {
      // Build assistant message starting with text content
      const assistantContent: (Anthropic.TextBlock | Anthropic.ToolUseBlock)[] = [
        { type: 'text', text: event.data as string },
      ];
      i++;

      // Collect any tool calls that immediately follow this agent message
      const toolCallsInMessage: ToolCallData[] = [];
      while (i < events.length && events[i].type === 'TOOL_CALL') {
        const toolCall = events[i].data as ToolCallData;
        toolCallsInMessage.push(toolCall);

        assistantContent.push({
          type: 'tool_use',
          id: toolCall.callId,
          name: toolCall.toolName,
          input: toolCall.input,
        });
        i++;
      }

      messages.push({ role: 'assistant', content: assistantContent });

      // If there were tool calls, collect their results
      if (toolCallsInMessage.length > 0) {
        const toolResults: { type: 'tool_result'; tool_use_id: string; content: string }[] = [];

        // Match each tool call with its result
        for (const toolCall of toolCallsInMessage) {
          // Find the corresponding result
          if (i < events.length && events[i].type === 'TOOL_RESULT') {
            const toolResult = events[i].data as ToolResultData;
            if (toolResult.callId === toolCall.callId) {
              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolCall.callId,
                content: toolResult.output,
              });
              i++;
            } else {
              throw new Error(
                `Tool result callId mismatch: expected ${toolCall.callId}, got ${toolResult.callId}`
              );
            }
          } else {
            throw new Error(`Tool result not found for tool call ${toolCall.callId}`);
          }
        }

        if (toolResults.length > 0) {
          messages.push({ role: 'user', content: toolResults });
        }
      }
    } else if (event.type === 'TOOL_CALL') {
      throw new Error('Tool call found without preceding agent message');
    } else if (event.type === 'TOOL_RESULT') {
      throw new Error('Tool result without corresponding tool call');
    } else {
      throw new Error(`Unknown event type: ${event.type}`);
    }
  }

  return messages;
}
