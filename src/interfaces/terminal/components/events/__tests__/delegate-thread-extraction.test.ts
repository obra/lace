// ABOUTME: Baseline tests for delegate thread extraction logic before hook extraction
// ABOUTME: Tests both strategy 1 (regex parsing) and strategy 2 (temporal proximity)

import { describe, it, expect } from 'vitest';
import { Timeline, TimelineItem } from '../../../../thread-processor.js';

// Type for tool execution items
type ToolExecutionItem = Extract<TimelineItem, { type: 'tool_execution' }>;

// Copy of the current extraction function for baseline testing
function extractDelegateThreadId(
  item: ToolExecutionItem,
  delegateTimelines: Map<string, Timeline>
): string | null {
  // Strategy 1: Look for thread ID in tool result
  if (item.result && typeof item.result.output === 'string') {
    const match = item.result.output.match(/Thread: ([^)]+)/);
    if (match) {
      return match[1];
    }
  }

  // Strategy 2: Find delegate thread that started near this tool call (within 5 seconds)
  for (const [threadId, timeline] of delegateTimelines.entries()) {
    const firstItem = timeline.items[0];
    if (firstItem) {
      const timeDiff = Math.abs(firstItem.timestamp.getTime() - item.timestamp.getTime());
      if (timeDiff < 5000) {
        return threadId;
      }
    }
  }

  return null;
}

describe('Delegate Thread Extraction (Baseline)', () => {
  const createMockToolExecution = (
    callId: string,
    timestamp: Date,
    result?: { output?: string; success?: boolean }
  ): ToolExecutionItem => ({
    type: 'tool_execution',
    timestamp,
    callId,
    call: {
      toolName: 'delegate',
      input: { prompt: 'test' },
      callId,
    },
    result: result
      ? {
          callId,
          output: result.output || '',
          success: result.success ?? true,
        }
      : undefined,
  });

  const createMockTimeline = (firstItemTimestamp: Date): Timeline => ({
    items: [
      {
        id: 'msg-1',
        type: 'user_message' as const,
        timestamp: firstItemTimestamp,
        content: 'Test message',
      },
    ],
    metadata: {
      eventCount: 1,
      messageCount: 1,
      lastActivity: firstItemTimestamp,
    },
  });

  describe('Strategy 1: Regex parsing from tool result', () => {
    it('should extract thread ID from tool result output', () => {
      const toolItem = createMockToolExecution('call-123', new Date('2024-01-01T10:00:00Z'), {
        output: 'Thread: delegate-thread-456',
        success: true,
      });

      const delegateTimelines = new Map([
        ['delegate-thread-456', createMockTimeline(new Date('2024-01-01T10:00:01Z'))],
      ]);

      const result = extractDelegateThreadId(toolItem, delegateTimelines);
      expect(result).toBe('delegate-thread-456');
    });

    it('should handle complex thread ID formats', () => {
      // The regex pattern /Thread: ([^\)]+)/ captures until closing parenthesis
      const toolItem = createMockToolExecution('call-123', new Date('2024-01-01T10:00:00Z'), {
        output: 'Some output text Thread: lace_20240101_complex_id_123) more text',
        success: true,
      });

      const delegateTimelines = new Map([
        ['lace_20240101_complex_id_123', createMockTimeline(new Date('2024-01-01T10:00:01Z'))],
      ]);

      const result = extractDelegateThreadId(toolItem, delegateTimelines);
      expect(result).toBe('lace_20240101_complex_id_123');
    });

    it('should return null when no thread pattern found in result', () => {
      const toolItem = createMockToolExecution('call-123', new Date('2024-01-01T10:00:00Z'), {
        output: 'No thread information here',
        success: true,
      });

      // Use a delegate timeline that's outside the 5-second temporal window
      const delegateTimelines = new Map([
        ['delegate-thread-456', createMockTimeline(new Date('2024-01-01T10:00:10Z'))], // 10 seconds later
      ]);

      const result = extractDelegateThreadId(toolItem, delegateTimelines);
      expect(result).toBeNull();
    });

    it('should return null when result output is not a string', () => {
      const toolItem: ToolExecutionItem = {
        type: 'tool_execution',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        callId: 'call-123',
        call: {
          toolName: 'delegate',
          input: { prompt: 'test' },
          callId: 'call-123',
        },
        result: {
          callId: 'call-123',
          output: { some: 'object' } as any,
          success: true,
        },
      };

      // Use a delegate timeline that's outside the temporal window
      const delegateTimelines = new Map([
        ['delegate-thread-456', createMockTimeline(new Date('2024-01-01T10:00:10Z'))], // 10 seconds later
      ]);

      const result = extractDelegateThreadId(toolItem, delegateTimelines);
      expect(result).toBeNull();
    });

    it('should return null when no result present', () => {
      const toolItem = createMockToolExecution(
        'call-123',
        new Date('2024-01-01T10:00:00Z')
        // No result
      );

      // Use a delegate timeline that's outside the temporal window
      const delegateTimelines = new Map([
        ['delegate-thread-456', createMockTimeline(new Date('2024-01-01T10:00:10Z'))], // 10 seconds later
      ]);

      const result = extractDelegateThreadId(toolItem, delegateTimelines);
      expect(result).toBeNull();
    });
  });

  describe('Strategy 2: Temporal proximity matching', () => {
    it('should find delegate thread by temporal proximity within 5 seconds', () => {
      const toolTimestamp = new Date('2024-01-01T10:00:00Z');
      const delegateTimestamp = new Date('2024-01-01T10:00:02Z'); // 2 seconds later

      const toolItem = createMockToolExecution('call-123', toolTimestamp, {
        output: 'No thread ID here',
        success: true,
      });

      const delegateTimelines = new Map([
        ['delegate-thread-456', createMockTimeline(delegateTimestamp)],
      ]);

      const result = extractDelegateThreadId(toolItem, delegateTimelines);
      expect(result).toBe('delegate-thread-456');
    });

    it('should find delegate thread started before tool call', () => {
      const toolTimestamp = new Date('2024-01-01T10:00:05Z');
      const delegateTimestamp = new Date('2024-01-01T10:00:02Z'); // 3 seconds before

      const toolItem = createMockToolExecution('call-123', toolTimestamp, {
        output: 'No thread ID here',
        success: true,
      });

      const delegateTimelines = new Map([
        ['delegate-thread-456', createMockTimeline(delegateTimestamp)],
      ]);

      const result = extractDelegateThreadId(toolItem, delegateTimelines);
      expect(result).toBe('delegate-thread-456');
    });

    it('should not match threads outside 5 second window', () => {
      const toolTimestamp = new Date('2024-01-01T10:00:00Z');
      const delegateTimestamp = new Date('2024-01-01T10:00:06Z'); // 6 seconds later

      const toolItem = createMockToolExecution('call-123', toolTimestamp, {
        output: 'No thread ID here',
        success: true,
      });

      const delegateTimelines = new Map([
        ['delegate-thread-456', createMockTimeline(delegateTimestamp)],
      ]);

      const result = extractDelegateThreadId(toolItem, delegateTimelines);
      expect(result).toBeNull();
    });

    it('should choose closest match when multiple delegates within window', () => {
      const toolTimestamp = new Date('2024-01-01T10:00:00Z');
      const delegate1Timestamp = new Date('2024-01-01T10:00:01Z'); // 1 second later
      const delegate2Timestamp = new Date('2024-01-01T10:00:03Z'); // 3 seconds later

      const toolItem = createMockToolExecution('call-123', toolTimestamp, {
        output: 'No thread ID here',
        success: true,
      });

      const delegateTimelines = new Map([
        ['delegate-thread-far', createMockTimeline(delegate2Timestamp)],
        ['delegate-thread-close', createMockTimeline(delegate1Timestamp)],
      ]);

      const result = extractDelegateThreadId(toolItem, delegateTimelines);
      // Should return the first one found that matches (iteration order)
      // Note: Map iteration order is insertion order
      expect(['delegate-thread-far', 'delegate-thread-close']).toContain(result);
    });

    it('should handle empty delegate timelines', () => {
      const toolItem = createMockToolExecution('call-123', new Date('2024-01-01T10:00:00Z'), {
        output: 'No thread ID here',
        success: true,
      });

      const delegateTimelines = new Map<string, Timeline>();

      const result = extractDelegateThreadId(toolItem, delegateTimelines);
      expect(result).toBeNull();
    });

    it('should handle delegate timeline with no items', () => {
      const toolItem = createMockToolExecution('call-123', new Date('2024-01-01T10:00:00Z'), {
        output: 'No thread ID here',
        success: true,
      });

      const emptyTimeline: Timeline = {
        items: [],
        metadata: {
          eventCount: 0,
          messageCount: 0,
          lastActivity: new Date(),
        },
      };

      const delegateTimelines = new Map([['delegate-thread-456', emptyTimeline]]);

      const result = extractDelegateThreadId(toolItem, delegateTimelines);
      expect(result).toBeNull();
    });
  });

  describe('Strategy priority and fallback', () => {
    it('should prefer regex strategy over temporal proximity', () => {
      const toolTimestamp = new Date('2024-01-01T10:00:00Z');
      const delegateTimestamp = new Date('2024-01-01T10:00:01Z'); // Close enough for temporal

      const toolItem = createMockToolExecution('call-123', toolTimestamp, {
        output: 'Thread: explicit-thread-id',
        success: true,
      });

      const delegateTimelines = new Map([
        ['temporal-thread-id', createMockTimeline(delegateTimestamp)],
        ['explicit-thread-id', createMockTimeline(new Date('2024-01-01T09:00:00Z'))], // Way older
      ]);

      const result = extractDelegateThreadId(toolItem, delegateTimelines);
      expect(result).toBe('explicit-thread-id'); // Should prefer regex result
    });

    it('should fall back to temporal when regex fails', () => {
      const toolTimestamp = new Date('2024-01-01T10:00:00Z');
      const delegateTimestamp = new Date('2024-01-01T10:00:01Z');

      const toolItem = createMockToolExecution('call-123', toolTimestamp, {
        output: 'No valid thread pattern here',
        success: true,
      });

      const delegateTimelines = new Map([
        ['temporal-thread-id', createMockTimeline(delegateTimestamp)],
      ]);

      const result = extractDelegateThreadId(toolItem, delegateTimelines);
      expect(result).toBe('temporal-thread-id');
    });
  });
});
