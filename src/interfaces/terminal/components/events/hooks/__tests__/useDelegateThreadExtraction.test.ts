// ABOUTME: Tests for useDelegateThreadExtraction hook
// ABOUTME: Verifies memoization behavior and extraction logic for React hook

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { Timeline, TimelineItem } from '../../../../../thread-processor.js';
import { useDelegateThreadExtraction } from '../useDelegateThreadExtraction.js';

// Type for tool execution items
type ToolExecutionItem = Extract<TimelineItem, { type: 'tool_execution' }>;

describe('useDelegateThreadExtraction Hook', () => {
  const createMockToolExecution = (
    callId: string,
    timestamp: Date,
    result?: { content?: Array<{ type: 'text'; text: string }>; isError?: boolean }
  ): ToolExecutionItem => ({
    type: 'tool_execution',
    timestamp,
    callId,
    call: {
      id: callId,
      name: 'delegate',
      arguments: { prompt: 'test' },
    },
    result: result
      ? {
          id: callId,
          content: result.content || [],
          isError: result.isError || false,
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

  describe('Hook behavior', () => {
    it('should return extractor function', () => {
      const delegateTimelines = new Map([['thread-1', createMockTimeline(new Date())]]);

      const { result } = renderHook(() => useDelegateThreadExtraction(delegateTimelines));

      expect(result.current).toHaveProperty('extractDelegateThreadId');
      expect(typeof result.current.extractDelegateThreadId).toBe('function');
    });

    it('should handle undefined delegate timelines', () => {
      const { result } = renderHook(() => useDelegateThreadExtraction(undefined));

      const toolItem = createMockToolExecution('call-123', new Date(), {
        content: [{ type: 'text', text: 'Thread: some-thread' }],
        isError: false,
      });

      const threadId = result.current.extractDelegateThreadId(toolItem);
      expect(threadId).toBeNull();
    });

    it('should handle empty delegate timelines', () => {
      const { result } = renderHook(() => useDelegateThreadExtraction(new Map()));

      const toolItem = createMockToolExecution('call-123', new Date(), {
        content: [{ type: 'text', text: 'Thread: some-thread' }],
        isError: false,
      });

      const threadId = result.current.extractDelegateThreadId(toolItem);
      expect(threadId).toBeNull();
    });
  });

  describe('Memoization behavior', () => {
    it('should return same extractor function when delegate timelines unchanged', () => {
      const delegateTimelines = new Map([['thread-1', createMockTimeline(new Date())]]);

      const { result, rerender } = renderHook(
        ({ timelines }) => useDelegateThreadExtraction(timelines),
        { initialProps: { timelines: delegateTimelines } }
      );

      const firstExtractor = result.current;

      // Re-render with same timelines
      rerender({ timelines: delegateTimelines });

      const secondExtractor = result.current;

      // Should be the same reference due to memoization
      expect(firstExtractor).toBe(secondExtractor);
    });

    it('should return new extractor function when delegate timelines change', () => {
      const initialTimelines = new Map([['thread-1', createMockTimeline(new Date())]]);

      const updatedTimelines = new Map([
        ['thread-1', createMockTimeline(new Date())],
        ['thread-2', createMockTimeline(new Date())],
      ]);

      const { result, rerender } = renderHook(
        ({ timelines }) => useDelegateThreadExtraction(timelines),
        { initialProps: { timelines: initialTimelines } }
      );

      const firstExtractor = result.current;

      // Re-render with different timelines
      rerender({ timelines: updatedTimelines });

      const secondExtractor = result.current;

      // Should be different references since timelines changed
      expect(firstExtractor).not.toBe(secondExtractor);
    });
  });

  describe('Extraction functionality', () => {
    it('should extract thread ID using regex strategy', () => {
      const delegateTimelines = new Map([
        ['explicit-thread-id', createMockTimeline(new Date('2024-01-01T09:00:00Z'))],
      ]);

      const { result } = renderHook(() => useDelegateThreadExtraction(delegateTimelines));

      const toolItem = createMockToolExecution('call-123', new Date('2024-01-01T10:00:00Z'), {
        content: [{ type: 'text', text: 'Thread: explicit-thread-id)' }],
        isError: false,
      });

      const threadId = result.current.extractDelegateThreadId(toolItem);
      expect(threadId).toBe('explicit-thread-id');
    });

    it('should extract thread ID using temporal proximity strategy', () => {
      const toolTimestamp = new Date('2024-01-01T10:00:00Z');
      const delegateTimestamp = new Date('2024-01-01T10:00:02Z'); // 2 seconds later

      const delegateTimelines = new Map([
        ['temporal-thread-id', createMockTimeline(delegateTimestamp)],
      ]);

      const { result } = renderHook(() => useDelegateThreadExtraction(delegateTimelines));

      const toolItem = createMockToolExecution('call-123', toolTimestamp, {
        content: [{ type: 'text', text: 'No thread ID here' }],
        isError: false,
      });

      const threadId = result.current.extractDelegateThreadId(toolItem);
      expect(threadId).toBe('temporal-thread-id');
    });

    it('should prefer regex strategy over temporal proximity', () => {
      const toolTimestamp = new Date('2024-01-01T10:00:00Z');
      const delegateTimestamp = new Date('2024-01-01T10:00:01Z'); // Close enough for temporal

      const delegateTimelines = new Map([
        ['temporal-thread-id', createMockTimeline(delegateTimestamp)],
        ['explicit-thread-id', createMockTimeline(new Date('2024-01-01T09:00:00Z'))], // Way older
      ]);

      const { result } = renderHook(() => useDelegateThreadExtraction(delegateTimelines));

      const toolItem = createMockToolExecution('call-123', toolTimestamp, {
        content: [{ type: 'text', text: 'Thread: explicit-thread-id)' }],
        isError: false,
      });

      const threadId = result.current.extractDelegateThreadId(toolItem);
      expect(threadId).toBe('explicit-thread-id'); // Should prefer regex result
    });

    it('should return null when no thread found', () => {
      const delegateTimelines = new Map([
        ['thread-1', createMockTimeline(new Date('2024-01-01T10:00:10Z'))], // Too far away
      ]);

      const { result } = renderHook(() => useDelegateThreadExtraction(delegateTimelines));

      const toolItem = createMockToolExecution('call-123', new Date('2024-01-01T10:00:00Z'), {
        content: [{ type: 'text', text: 'No thread information' }],
        isError: false,
      });

      const threadId = result.current.extractDelegateThreadId(toolItem);
      expect(threadId).toBeNull();
    });
  });

  describe('Edge cases', () => {
    it('should handle tool execution without result', () => {
      const delegateTimelines = new Map([
        ['thread-1', createMockTimeline(new Date('2024-01-01T10:00:10Z'))], // Outside temporal window
      ]);

      const { result } = renderHook(() => useDelegateThreadExtraction(delegateTimelines));

      const toolItem = createMockToolExecution(
        'call-123',
        new Date('2024-01-01T10:00:00Z')
        // No result
      );

      const threadId = result.current.extractDelegateThreadId(toolItem);
      expect(threadId).toBeNull();
    });

    it('should handle delegate timeline with no items', () => {
      const emptyTimeline: Timeline = {
        items: [],
        metadata: {
          eventCount: 0,
          messageCount: 0,
          lastActivity: new Date(),
        },
      };

      const delegateTimelines = new Map([['empty-thread', emptyTimeline]]);

      const { result } = renderHook(() => useDelegateThreadExtraction(delegateTimelines));

      const toolItem = createMockToolExecution('call-123', new Date('2024-01-01T10:00:00Z'), {
        content: [{ type: 'text', text: 'No thread info' }],
        isError: false,
      });

      const threadId = result.current.extractDelegateThreadId(toolItem);
      expect(threadId).toBeNull();
    });

    it('should handle non-string result output', () => {
      const delegateTimelines = new Map([
        ['thread-1', createMockTimeline(new Date('2024-01-01T10:00:10Z'))], // Outside temporal window
      ]);

      const { result } = renderHook(() => useDelegateThreadExtraction(delegateTimelines));

      const toolItem: ToolExecutionItem = {
        type: 'tool_execution',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        callId: 'call-123',
        call: {
          id: 'call-123',
          name: 'delegate',
          arguments: { prompt: 'test' },
        },
        result: {
          id: 'call-123',
          content: [{ type: 'text' as const, text: 'some object' }],
          isError: false,
        },
      };

      const threadId = result.current.extractDelegateThreadId(toolItem);
      expect(threadId).toBeNull();
    });
  });
});
