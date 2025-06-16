// ABOUTME: Builds provider-agnostic conversation format from thread events
// ABOUTME: Handles proper grouping of messages, tool calls, and tool results

import { ProviderMessage } from '../providers/types.js';
import { ThreadEvent, ToolCallData, ToolResultData } from './types.js';

export function buildConversationFromEvents(events: ThreadEvent[]): ProviderMessage[] {
  const messages: ProviderMessage[] = [];

  for (const event of events) {
    if (event.type === 'USER_MESSAGE') {
      messages.push({ role: 'user', content: event.data as string });
    } else if (event.type === 'AGENT_MESSAGE') {
      messages.push({ role: 'assistant', content: event.data as string });
    } else if (event.type === 'TOOL_CALL') {
      const toolCall = event.data as ToolCallData;
      messages.push({
        role: 'assistant',
        content: `[Called tool: ${toolCall.toolName} with input: ${JSON.stringify(toolCall.input)}]`,
      });
    } else if (event.type === 'TOOL_RESULT') {
      const toolResult = event.data as ToolResultData;
      messages.push({
        role: 'user',
        content: `[Tool result: ${toolResult.success ? 'SUCCESS' : 'ERROR'} - ${toolResult.output}${toolResult.error ? ` (Error: ${toolResult.error})` : ''}]`,
      });
    } else {
      throw new Error(`Unknown event type: ${event.type}`);
    }
  }

  return messages;
}
