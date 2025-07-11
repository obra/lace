// ABOUTME: Regression tests for conversation building using real failing thread data
// ABOUTME: Tests the _buildConversationFromEvents method to prevent tool_use_id mismatch errors

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Agent } from '~/agents/agent.js';
import { ThreadEvent } from '~/threads/types.js';
import { ProviderMessage, AIProvider } from '~/providers/base-provider.js';
import { convertToAnthropicFormat } from '~/providers/format-converters.js';
import { ToolExecutor } from '~/tools/executor.js';
import { ThreadManager } from '~/threads/thread-manager.js';

// Helper function for type-safe private method access
function buildConversationFromEvents(agent: Agent, events: ThreadEvent[]): ProviderMessage[] {
  return (agent as unknown as { _buildConversationFromEvents: (events: ThreadEvent[]) => ProviderMessage[] })._buildConversationFromEvents(events);
}

/**
 * Real thread event data from lace_20250705_2opxkw that caused the API failure:
 * "messages.4.content.0: unexpected `tool_use_id` found in `tool_result` blocks:
 * toolu_012RDexnDVgu6QthBGZZ45RH. Each `tool_result` block must have a
 * corresponding `tool_use` block in the previous message."
 *
 * The original thread has 89 events:
 * - 33 TOOL_CALL events
 * - 33 TOOL_RESULT events
 * - 17 AGENT_MESSAGE events
 * - 4 USER_MESSAGE events
 * - 1 SYSTEM_PROMPT event
 * - 1 USER_SYSTEM_PROMPT event
 */

// Load the full thread data
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FULL_THREAD_DATA_PATH = join(__dirname, 'data', 'full_thread_events.json');
let fullThreadEvents: ThreadEvent[] = [];

try {
  const data = readFileSync(FULL_THREAD_DATA_PATH, 'utf8');
  const rawEvents = JSON.parse(data) as unknown[];
  // Convert timestamp strings to Date objects for TypeScript compatibility
  fullThreadEvents = rawEvents.map((event: unknown) => {
    if (typeof event === 'object' && event !== null && 'timestamp' in event) {
      return {
        ...event,
        timestamp: new Date((event as { timestamp: string }).timestamp),
      } as ThreadEvent;
    }
    return event as ThreadEvent;
  });
} catch {
  console.warn('Could not load full thread data, using sample data instead');
  // Fallback to sample data if full data not available
}

describe('Conversation Building Regression Tests', () => {
  // Extract of the critical event sequence that caused the bug (sample)
  const sampleEventSequence: ThreadEvent[] = [
    {
      id: 'evt_1751729643019_tka8scjv6',
      threadId: 'lace_20250705_2opxkw',
      type: 'SYSTEM_PROMPT',
      timestamp: new Date('2025-07-05T15:34:03.019Z'),
      data: 'System prompt content...',
    },
    {
      id: 'evt_1751729643021_nirgfm08p',
      threadId: 'lace_20250705_2opxkw',
      type: 'USER_SYSTEM_PROMPT',
      timestamp: new Date('2025-07-05T15:34:03.021Z'),
      data: 'User system prompt content...',
    },
    {
      id: 'evt_1751729670935_vhy84p2kk',
      threadId: 'lace_20250705_2opxkw',
      type: 'USER_MESSAGE',
      timestamp: new Date('2025-07-05T15:34:30.935Z'),
      data: "How's it going?",
    },
    {
      id: 'evt_1751729677673_fyjr751ho',
      threadId: 'lace_20250705_2opxkw',
      type: 'AGENT_MESSAGE',
      timestamp: new Date('2025-07-05T15:34:37.673Z'),
      data: "Hey there! Things are going well - I'm ready to help you with whatever you're working on in your lace project.\n\nI can see you're in a TypeScript/Node.js project with a solid structure - looks like you've got CLI tools, agents, persistence, and a comprehensive test setup. The architecture docs suggest this is a pretty sophisticated system.\n\nWhat would you like to work on today? Whether it's debugging, adding features, refactoring, or just exploring the codebase, I'm here to help!",
    },
    {
      id: 'evt_1751731558773_ow2tmw2nv',
      threadId: 'lace_20250705_2opxkw',
      type: 'USER_MESSAGE',
      timestamp: new Date('2025-07-05T16:05:58.773Z'),
      data: "Hi. We recently upgraded your task management tool. I'd like you to test out the various tools that are part of the task management suite and report back.",
    },
    {
      id: 'evt_1751731563862_x3do345xk',
      threadId: 'lace_20250705_2opxkw',
      type: 'AGENT_MESSAGE',
      timestamp: new Date('2025-07-05T16:06:03.862Z'),
      data: "I'll test out the task management tools to see how they work. Let me start by exploring what's currently available and then test each function.",
    },
    {
      id: 'evt_1751731563870_danpj5hth',
      threadId: 'lace_20250705_2opxkw',
      type: 'TOOL_CALL',
      timestamp: new Date('2025-07-05T16:06:03.870Z'),
      data: {
        id: 'toolu_012RDexnDVgu6QthBGZZ45RH',
        name: 'task_list',
        arguments: { filter: 'all', includeCompleted: true },
      },
    },
    {
      id: 'evt_1751731579685_xkymz4vzm',
      threadId: 'lace_20250705_2opxkw',
      type: 'TOOL_RESULT',
      timestamp: new Date('2025-07-05T16:06:19.685Z'),
      data: {
        content: [{ type: 'text', text: 'No tasks found' }],
        isError: false,
        id: 'toolu_012RDexnDVgu6QthBGZZ45RH',
      },
    },
    {
      id: 'evt_1751731585752_3zq9ap1uc',
      threadId: 'lace_20250705_2opxkw',
      type: 'AGENT_MESSAGE',
      timestamp: new Date('2025-07-05T16:06:25.752Z'),
      data: 'Good - starting with a clean slate. Let me test the task management suite systematically:',
    },
  ];

  describe('Full Thread Data Tests', () => {
    it('should load and process the complete failing thread (89 events)', () => {
      if (fullThreadEvents.length === 0) {
        console.warn('Skipping full thread test - data not available');
        return;
      }

      expect(fullThreadEvents).toHaveLength(89);

      // Verify event counts match expected
      const eventCounts = fullThreadEvents.reduce(
        (acc, event) => {
          acc[event.type] = (acc[event.type] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

      expect(eventCounts.TOOL_CALL).toBe(33);
      expect(eventCounts.TOOL_RESULT).toBe(33);
      expect(eventCounts.AGENT_MESSAGE).toBe(17);
      expect(eventCounts.USER_MESSAGE).toBe(4);
      expect(eventCounts.SYSTEM_PROMPT).toBe(1);
      expect(eventCounts.USER_SYSTEM_PROMPT).toBe(1);
    });

    it('should build conversation from full thread without errors', () => {
      if (fullThreadEvents.length === 0) {
        console.warn('Skipping full thread test - data not available');
        return;
      }

      const mockAgent = new Agent({
        provider: {} as AIProvider,
        toolExecutor: {} as ToolExecutor,
        threadManager: {} as ThreadManager,
        threadId: 'test',
        tools: [],
      });

      // This should not throw an error
      expect(() => {
        const conversation: ProviderMessage[] = buildConversationFromEvents(
          mockAgent,
          fullThreadEvents
        );
        expect(conversation).toBeDefined();
        expect(Array.isArray(conversation)).toBe(true);
      }).not.toThrow();
    });

    it('should maintain perfect tool call/result pairing in full thread', () => {
      if (fullThreadEvents.length === 0) {
        console.warn('Skipping full thread test - data not available');
        return;
      }

      const mockAgent = new Agent({
        provider: {} as AIProvider,
        toolExecutor: {} as ToolExecutor,
        threadManager: {} as ThreadManager,
        threadId: 'test',
        tools: [],
      });

      const conversation: ProviderMessage[] = buildConversationFromEvents(
        mockAgent,
        fullThreadEvents
      );

      // Collect all tool use IDs and tool result IDs
      const toolUseIds = new Set<string>();
      const toolResultIds = new Set<string>();

      for (const message of conversation) {
        if (message.toolCalls) {
          for (const toolCall of message.toolCalls) {
            toolUseIds.add(toolCall.id);
          }
        }
        if (message.toolResults) {
          for (const toolResult of message.toolResults) {
            toolResultIds.add(toolResult.id);
          }
        }
      }

      // Should have exactly 33 of each
      expect(toolUseIds.size).toBe(33);
      expect(toolResultIds.size).toBe(33);

      // Every tool result should have a corresponding tool use
      for (const resultId of toolResultIds) {
        expect(toolUseIds.has(resultId)).toBe(true);
      }

      // Every tool use should have a corresponding tool result
      for (const useId of toolUseIds) {
        expect(toolResultIds.has(useId)).toBe(true);
      }
    });

    it('should convert full thread to valid Anthropic format', () => {
      if (fullThreadEvents.length === 0) {
        console.warn('Skipping full thread test - data not available');
        return;
      }

      const mockAgent = new Agent({
        provider: {} as AIProvider,
        toolExecutor: {} as ToolExecutor,
        threadManager: {} as ThreadManager,
        threadId: 'test',
        tools: [],
      });

      const conversation: ProviderMessage[] = buildConversationFromEvents(
        mockAgent,
        fullThreadEvents
      );

      // This should not throw - it should convert successfully
      expect(() => {
        const anthropicMessages = convertToAnthropicFormat(conversation);
        expect(anthropicMessages).toBeDefined();
        expect(Array.isArray(anthropicMessages)).toBe(true);
      }).not.toThrow();
    });

    it('should detect the specific failing tool_use_id in the thread', () => {
      if (fullThreadEvents.length === 0) {
        console.warn('Skipping full thread test - data not available');
        return;
      }

      // Look for the specific tool_use_id that caused the original failure
      const targetToolId = 'toolu_012RDexnDVgu6QthBGZZ45RH';

      const toolCallEvent = fullThreadEvents.find(
        (event) =>
          event.type === 'TOOL_CALL' &&
          event.data &&
          typeof event.data === 'object' &&
          'id' in event.data &&
          event.data.id === targetToolId
      );

      const toolResultEvent = fullThreadEvents.find(
        (event) =>
          event.type === 'TOOL_RESULT' &&
          event.data &&
          typeof event.data === 'object' &&
          'id' in event.data &&
          event.data.id === targetToolId
      );

      expect(toolCallEvent).toBeDefined();
      expect(toolResultEvent).toBeDefined();

      // Verify the tool call comes before the tool result
      const callIndex = fullThreadEvents.indexOf(toolCallEvent!);
      const resultIndex = fullThreadEvents.indexOf(toolResultEvent!);
      expect(callIndex).toBeLessThan(resultIndex);
    });
  });

  describe('Sample Event Sequence Tests', () => {
    it('should properly pair tool calls with tool results', () => {
      const mockAgent = new Agent({
        provider: {} as AIProvider,
        toolExecutor: {} as ToolExecutor,
        threadManager: {} as ThreadManager,
        threadId: 'test',
        tools: [],
      });

      const conversation = buildConversationFromEvents(mockAgent, sampleEventSequence);

      // Verify the conversation structure
      expect(conversation).toBeDefined();
      expect(Array.isArray(conversation)).toBe(true);

      // Find the assistant message that should contain the tool call
      const assistantWithToolCall = conversation.find(
        (msg: ProviderMessage) =>
          msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0
      );

      expect(assistantWithToolCall).toBeDefined();
      expect(assistantWithToolCall!.toolCalls).toHaveLength(1);
      expect(assistantWithToolCall!.toolCalls![0].id).toBe('toolu_012RDexnDVgu6QthBGZZ45RH');

      // Find the user message that should contain the tool result
      const userWithToolResult = conversation.find(
        (msg: ProviderMessage) =>
          msg.role === 'user' && msg.toolResults && msg.toolResults.length > 0
      );

      expect(userWithToolResult).toBeDefined();
      expect(userWithToolResult!.toolResults).toHaveLength(1);
      expect(userWithToolResult!.toolResults![0].id).toBe('toolu_012RDexnDVgu6QthBGZZ45RH');

      // Verify they reference the same tool_use_id
      expect(assistantWithToolCall!.toolCalls![0].id).toBe(userWithToolResult!.toolResults![0].id);
    });

    it('should not create orphaned tool results', () => {
      const mockAgent = new Agent({
        provider: {} as AIProvider,
        toolExecutor: {} as ToolExecutor,
        threadManager: {} as ThreadManager,
        threadId: 'test',
        tools: [],
      });

      const conversation = buildConversationFromEvents(mockAgent, sampleEventSequence);

      // Collect all tool_use_ids and tool_result_ids
      const toolUseIds = new Set<string>();
      const toolResultIds = new Set<string>();

      for (const message of conversation) {
        if (message.toolCalls) {
          for (const toolCall of message.toolCalls) {
            toolUseIds.add(toolCall.id);
          }
        }
        if (message.toolResults) {
          for (const toolResult of message.toolResults) {
            toolResultIds.add(toolResult.id);
          }
        }
      }

      // Every tool result should have a corresponding tool use
      for (const resultId of toolResultIds) {
        expect(toolUseIds.has(resultId)).toBe(true);
      }
    });

    it('should validate against Anthropic API format', () => {
      const mockAgent = new Agent({
        provider: {} as AIProvider,
        toolExecutor: {} as ToolExecutor,
        threadManager: {} as ThreadManager,
        threadId: 'test',
        tools: [],
      });

      const conversation = buildConversationFromEvents(mockAgent, sampleEventSequence);

      // Convert to Anthropic format to ensure it would pass API validation
      expect(() => {
        const anthropicMessages = convertToAnthropicFormat(conversation);
        expect(anthropicMessages).toBeDefined();
        expect(Array.isArray(anthropicMessages)).toBe(true);
      }).not.toThrow();

      // Verify basic structure
      expect(conversation).toBeDefined();
      expect(conversation.length).toBeGreaterThan(0);

      // Each message should have valid role
      for (const message of conversation) {
        expect(['user', 'assistant', 'system']).toContain(message.role);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle TOOL_CALL without corresponding TOOL_RESULT', () => {
      const eventsWithOrphanedCall: ThreadEvent[] = [
        ...sampleEventSequence.slice(0, 7), // Include up to the TOOL_CALL
        // Skip the TOOL_RESULT
        ...sampleEventSequence.slice(8), // Continue after TOOL_RESULT
      ];

      const mockAgent = new Agent({
        provider: {} as AIProvider,
        toolExecutor: {} as ToolExecutor,
        threadManager: {} as ThreadManager,
        threadId: 'test',
        tools: [],
      });

      // This should not throw an error, but should handle gracefully
      expect(() => {
        const conversation: ProviderMessage[] = buildConversationFromEvents(
          mockAgent,
          eventsWithOrphanedCall
        );
        expect(conversation).toBeDefined();
      }).not.toThrow();
    });

    it('should handle TOOL_RESULT without corresponding TOOL_CALL', () => {
      const eventsWithOrphanedResult: ThreadEvent[] = [
        ...sampleEventSequence.slice(0, 6), // Include up to the AGENT_MESSAGE
        // Skip the TOOL_CALL
        ...sampleEventSequence.slice(7), // Include TOOL_RESULT and after
      ];

      const mockAgent = new Agent({
        provider: {} as AIProvider,
        toolExecutor: {} as ToolExecutor,
        threadManager: {} as ThreadManager,
        threadId: 'test',
        tools: [],
      });

      // This currently fails - this is the bug we need to fix
      expect(() => {
        const conversation: ProviderMessage[] = buildConversationFromEvents(
          mockAgent,
          eventsWithOrphanedResult
        );

        // Verify no orphaned tool results exist
        const toolUseIds = new Set<string>();
        const toolResultIds = new Set<string>();

        for (const message of conversation) {
          if (message.toolCalls) {
            for (const toolCall of message.toolCalls) {
              toolUseIds.add(toolCall.id);
            }
          }
          if (message.toolResults) {
            for (const toolResult of message.toolResults) {
              toolResultIds.add(toolResult.id);
            }
          }
        }

        // This should pass after we fix the bug
        for (const resultId of toolResultIds) {
          expect(toolUseIds.has(resultId)).toBe(true);
        }
      }).not.toThrow();
    });

    it('should reproduce the original Anthropic API error scenario', () => {
      if (fullThreadEvents.length === 0) {
        console.warn('Skipping API error reproduction test - full thread data not available');
        return;
      }

      const mockAgent = new Agent({
        provider: {} as AIProvider,
        toolExecutor: {} as ToolExecutor,
        threadManager: {} as ThreadManager,
        threadId: 'test',
        tools: [],
      });

      // Build conversation and convert to Anthropic format
      const conversation: ProviderMessage[] = buildConversationFromEvents(
        mockAgent,
        fullThreadEvents
      );
      const anthropicMessages = convertToAnthropicFormat(conversation);

      // This should pass - we should NOT get the API error
      // If this fails, it means we've reproduced the bug
      let hasOrphanedToolResults = false;

      for (const message of anthropicMessages) {
        if (message.content && Array.isArray(message.content)) {
          for (const content of message.content) {
            if (content.type === 'tool_result') {
              // Check if this tool_result has a corresponding tool_use in the previous assistant message
              const prevMessage = anthropicMessages[anthropicMessages.indexOf(message) - 1];
              if (!prevMessage || prevMessage.role !== 'assistant') {
                hasOrphanedToolResults = true;
                break;
              }

              const hasMatchingToolUse = Array.isArray(prevMessage.content)
                ? prevMessage.content.some(
                    (c: unknown) => (c as { type?: string; id?: string }).type === 'tool_use' && (c as { type?: string; id?: string }).id === content.tool_use_id
                  )
                : false;

              if (!hasMatchingToolUse) {
                hasOrphanedToolResults = true;
                break;
              }
            }
          }
        }
      }

      expect(hasOrphanedToolResults).toBe(false);
    });
  });
});
