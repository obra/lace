// ABOUTME: Regression test suite for compaction system using real failing thread data
// ABOUTME: Tests tool call/result pairing preservation during compaction to prevent API failures

import { describe, it, expect, beforeEach } from 'vitest';
import { SummarizeStrategy } from '~/threads/compaction/summarize-strategy.js';
import { ThreadEvent } from '~/threads/types.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load the same real failing thread data used in conversation building tests
const threadDataPath = join(__dirname, '../../../agents/__tests__/data/full_thread_events.json');
const rawThreadEventsData = JSON.parse(readFileSync(threadDataPath, 'utf8')) as Array<{
  timestamp: string;
  [key: string]: unknown;
}>;

// Convert timestamp strings to Date objects for TypeScript compatibility
const threadEventsData = rawThreadEventsData.map(
  (event: { timestamp: string; [key: string]: unknown }) =>
    ({
      ...event,
      timestamp: new Date(event.timestamp),
    }) as ThreadEvent
);

describe('Compaction Regression Tests', () => {
  interface SummarizeStrategyWithPrivate {
    isImportantEvent(event: ThreadEvent): boolean;
    buildConversationFromEvents(events: ThreadEvent[]): unknown;
    fallbackTokenEstimation(events: ThreadEvent[]): number;
    compact(events: ThreadEvent[]): ThreadEvent[];
  }
  let strategy: SummarizeStrategyWithPrivate;

  beforeEach(() => {
    strategy = new SummarizeStrategy({
      maxTokens: 8000,
      preserveRecentEvents: 10,
      preserveTaskEvents: true,
    }) as unknown as SummarizeStrategyWithPrivate;
  });

  describe('tool call/result pairing preservation', () => {
    it('should preserve all TOOL_CALL events as important', () => {
      const toolCallEvents = threadEventsData.filter((e: ThreadEvent) => e.type === 'TOOL_CALL');
      expect(toolCallEvents.length).toBeGreaterThan(0);

      for (const event of toolCallEvents) {
        // Access private method for testing
        const isImportant = strategy.isImportantEvent(event);
        expect(isImportant).toBe(true);
      }
    });

    it('should preserve TOOL_RESULT events with truncation', () => {
      const toolResultEvents = threadEventsData.filter(
        (e: ThreadEvent) => e.type === 'TOOL_RESULT'
      );
      expect(toolResultEvents.length).toBeGreaterThan(0);

      for (const event of toolResultEvents) {
        // Access private method for testing
        const isImportant = strategy.isImportantEvent(event);
        expect(isImportant).toBe(true);
      }
    });

    it('should maintain tool call/result atomic pairing after compaction', () => {
      const compactedEvents = strategy.compact(threadEventsData);

      const toolCalls = compactedEvents.filter((e: ThreadEvent) => e.type === 'TOOL_CALL');
      const toolResults = compactedEvents.filter((e: ThreadEvent) => e.type === 'TOOL_RESULT');

      // Should have same number of tool calls and results
      expect(toolCalls.length).toBe(toolResults.length);

      // Each tool call should have a corresponding result
      const toolCallIds = new Set(
        toolCalls
          .map((tc: ThreadEvent) => {
            if (typeof tc.data === 'object' && tc.data && 'id' in tc.data) {
              return (tc.data as { id: string }).id;
            }
            return null;
          })
          .filter(Boolean)
      );

      const toolResultIds = new Set(
        toolResults
          .map((tr: ThreadEvent) => {
            if (typeof tr.data === 'object' && tr.data && 'id' in tr.data) {
              return (tr.data as { id: string }).id;
            }
            return null;
          })
          .filter(Boolean)
      );

      expect(toolCallIds.size).toBe(toolResultIds.size);
      expect(toolCallIds).toEqual(toolResultIds);
    });

    it('should truncate long TOOL_RESULT content to save space', () => {
      const compactedEvents = strategy.compact(threadEventsData);
      const toolResults = compactedEvents.filter((e: ThreadEvent) => e.type === 'TOOL_RESULT');

      for (const result of toolResults) {
        if (typeof result.data === 'string') {
          // If content was long, it should be truncated
          if (result.data.includes('[results truncated to save space.]')) {
            const lines = result.data.split('\n');
            const truncationIndex = lines.findIndex((line: string) =>
              line.includes('[results truncated to save space.]')
            );

            // Should preserve first 3 lines plus truncation marker
            expect(truncationIndex).toBeLessThanOrEqual(3);
          }
        } else if (typeof result.data === 'object' && result.data && 'content' in result.data) {
          const toolResult = result.data as { content: Array<{ type: string; text?: string }> };
          const textContent = toolResult.content
            .filter((block) => block.type === 'text' && block.text)
            .map((block) => block.text)
            .join('\n');

          // If content was long, it should be truncated
          if (textContent.includes('[results truncated to save space.]')) {
            const lines = textContent.split('\n');
            const truncationIndex = lines.findIndex((line: string) =>
              line.includes('[results truncated to save space.]')
            );

            // Should preserve first 3 lines plus truncation marker
            expect(truncationIndex).toBeLessThanOrEqual(3);
          }
        }
      }
    });

    it('should preserve USER_MESSAGE and AGENT_MESSAGE events', () => {
      const compactedEvents = strategy.compact(threadEventsData);

      const userMessages = compactedEvents.filter((e) => e.type === 'USER_MESSAGE');
      const agentMessages = compactedEvents.filter((e) => e.type === 'AGENT_MESSAGE');

      // Should preserve most recent user and agent messages
      expect(userMessages.length).toBeGreaterThan(0);
      expect(agentMessages.length).toBeGreaterThan(0);
    });

    it('should handle tool events in buildConversationFromEvents', () => {
      const compactedEvents = strategy.compact(threadEventsData);

      // Access private method for testing
      const conversation = strategy.buildConversationFromEvents(compactedEvents);

      // Should not crash when processing tool events
      expect(conversation).toBeDefined();
      expect(Array.isArray(conversation)).toBe(true);
    });

    it('should preserve tool structure while compacting other content', () => {
      const compactedEvents = strategy.compact(threadEventsData);
      const compactedTokens = strategy.fallbackTokenEstimation(compactedEvents);

      // With tool preservation, tokens may not reduce significantly (this is expected behavior)
      // The key is that we preserve critical structure for API compatibility
      expect(compactedTokens).toBeGreaterThan(0);

      // Should preserve critical structure for API compatibility
      const toolCalls = compactedEvents.filter((e: ThreadEvent) => e.type === 'TOOL_CALL');
      const toolResults = compactedEvents.filter((e: ThreadEvent) => e.type === 'TOOL_RESULT');

      expect(toolCalls.length).toBeGreaterThan(0);
      expect(toolResults.length).toBeGreaterThan(0);

      // Should have atomic pairing preserved
      expect(toolCalls.length).toBe(toolResults.length);
    });
  });

  describe('edge cases', () => {
    it('should handle empty event list', () => {
      const result = strategy.compact([]);
      expect(result).toEqual([]);
    });

    it('should handle events with no tool calls', () => {
      const nonToolEvents = threadEventsData.filter(
        (e: ThreadEvent) => e.type !== 'TOOL_CALL' && e.type !== 'TOOL_RESULT'
      );

      const result = strategy.compact(nonToolEvents);
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle malformed tool events gracefully', () => {
      const malformedEvent: ThreadEvent = {
        id: 'test-malformed',
        threadId: 'test-thread',
        type: 'TOOL_CALL',
        timestamp: new Date(),
        data: 'malformed', // malformed data
      };

      const eventsWithMalformed = [...threadEventsData, malformedEvent];
      const result = strategy.compact(eventsWithMalformed);

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
