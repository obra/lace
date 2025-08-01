import { describe, it, expect } from 'vitest';
import { TrimToolResultsStrategy } from '~/threads/compaction/trim-tool-results-strategy';
import type { ThreadEvent } from '~/threads/types';
import type { CompactionContext, CompactionData } from '~/threads/compaction/types';
import type { ToolResult } from '~/tools/types';

describe('TrimToolResultsStrategy', () => {
  const strategy = new TrimToolResultsStrategy();

  const mockContext: CompactionContext = {
    threadId: 'test-thread',
  };

  it('has correct strategy id', () => {
    expect(strategy.id).toBe('trim-tool-results');
  });

  describe('compact', () => {
    it('preserves non-tool-result events unchanged', async () => {
      const events: ThreadEvent[] = [
        {
          id: 'e1',
          threadId: 'test-thread',
          type: 'USER_MESSAGE',
          timestamp: new Date(),
          data: 'Hello',
        },
        {
          id: 'e2',
          threadId: 'test-thread',
          type: 'AGENT_MESSAGE',
          timestamp: new Date(),
          data: 'Hi there',
        },
      ];

      const result = await strategy.compact(events, mockContext);

      expect(result.type).toBe('COMPACTION');
      const compactionData = result.data as unknown as CompactionData;
      expect(compactionData.compactedEvents).toEqual(events);
      expect(compactionData.strategyId).toBe('trim-tool-results');
      expect(compactionData.originalEventCount).toBe(2);
    });

    it('truncates string tool results longer than 3 lines', async () => {
      const longResult = 'line1\nline2\nline3\nline4\nline5';
      const events: ThreadEvent[] = [
        {
          id: 'e1',
          threadId: 'test-thread',
          type: 'TOOL_RESULT',
          timestamp: new Date(),
          data: {
            id: 'tool-call-1',
            content: [{ type: 'text' as const, text: longResult }],
            isError: false,
          } satisfies ToolResult,
        },
      ];

      const result = await strategy.compact(events, mockContext);

      const compactionData = result.data as unknown as CompactionData;
      const compactedResult = compactionData.compactedEvents[0].data as {
        content: Array<{ type: string; text: string }>;
      };
      expect(compactedResult.content[0].text).toBe(
        'line1\nline2\nline3\n[results truncated to save space.]'
      );
    });

    it('preserves short tool results unchanged', async () => {
      const shortResult = 'line1\nline2';
      const events: ThreadEvent[] = [
        {
          id: 'e1',
          threadId: 'test-thread',
          type: 'TOOL_RESULT',
          timestamp: new Date(),
          data: {
            id: 'tool-call-2',
            content: [{ type: 'text' as const, text: shortResult }],
            isError: false,
          } satisfies ToolResult,
        },
      ];

      const result = await strategy.compact(events, mockContext);

      const compactionData = result.data as unknown as CompactionData;
      const compactedResult = compactionData.compactedEvents[0].data as {
        content: Array<{ type: string; text: string }>;
      };
      expect(compactedResult.content[0].text).toBe(shortResult);
    });

    it('handles ToolResult objects with content array', async () => {
      const toolResult: ToolResult = {
        content: [
          {
            type: 'text' as const,
            text: 'line1\nline2\nline3\nline4\nline5',
          },
        ],
        isError: false,
        id: 'tool-123',
      };

      const events: ThreadEvent[] = [
        {
          id: 'e1',
          threadId: 'test-thread',
          type: 'TOOL_RESULT',
          timestamp: new Date(),
          data: toolResult,
        },
      ];

      const result = await strategy.compact(events, mockContext);

      const compactionData = result.data as unknown as CompactionData;
      const compactedData = compactionData.compactedEvents[0].data as unknown as typeof toolResult;
      expect(compactedData.content[0].text).toBe(
        'line1\nline2\nline3\n[results truncated to save space.]'
      );
      expect(compactedData.isError).toBe(false);
      expect(compactedData.id).toBe('tool-123');
    });

    it('includes correct metadata', async () => {
      const events: ThreadEvent[] = [
        {
          id: 'e1',
          threadId: 'test-thread',
          type: 'TOOL_RESULT',
          timestamp: new Date(),
          data: {
            id: 'tool-call-3',
            content: [{ type: 'text' as const, text: 'line1\nline2\nline3\nline4' }],
            isError: false,
          } satisfies ToolResult,
        },
        {
          id: 'e2',
          threadId: 'test-thread',
          type: 'USER_MESSAGE',
          timestamp: new Date(),
          data: 'Hello',
        },
      ];

      const result = await strategy.compact(events, mockContext);

      const compactionData = result.data as unknown as CompactionData;
      expect(compactionData.metadata).toEqual({
        toolResultsModified: 1,
        maxLines: 3,
        truncationMessage: '[results truncated to save space.]',
      });
    });

    it('handles mixed content types in ToolResult', async () => {
      const toolResult: ToolResult = {
        content: [
          {
            type: 'text' as const,
            text: 'line1\nline2\nline3\nline4',
          },
          {
            type: 'image' as const,
            uri: 'http://example.com/image.png',
          },
        ],
        isError: false,
      };

      const events: ThreadEvent[] = [
        {
          id: 'e1',
          threadId: 'test-thread',
          type: 'TOOL_RESULT',
          timestamp: new Date(),
          data: toolResult,
        },
      ];

      const result = await strategy.compact(events, mockContext);

      const compactionData = result.data as unknown as CompactionData;
      const compactedData = compactionData.compactedEvents[0].data as unknown as typeof toolResult;
      expect(compactedData.content[0].text).toBe(
        'line1\nline2\nline3\n[results truncated to save space.]'
      );
      expect(compactedData.content[1]).toEqual({
        type: 'image',
        uri: 'http://example.com/image.png',
      });
    });

    it('handles tool results with no content', async () => {
      const toolResult: ToolResult = {
        content: [],
        isError: true,
        metadata: { errorMessage: 'Tool failed' },
      };

      const events: ThreadEvent[] = [
        {
          id: 'e1',
          threadId: 'test-thread',
          type: 'TOOL_RESULT',
          timestamp: new Date(),
          data: toolResult,
        },
      ];

      const result = await strategy.compact(events, mockContext);

      const compactionData = result.data as unknown as CompactionData;
      expect(compactionData.compactedEvents[0].data).toEqual(toolResult);
    });

    it('generates unique event IDs', async () => {
      const events: ThreadEvent[] = [
        {
          id: 'e1',
          threadId: 'test-thread',
          type: 'USER_MESSAGE',
          timestamp: new Date(),
          data: 'Hello',
        },
      ];

      const result1 = await strategy.compact(events, mockContext);
      const result2 = await strategy.compact(events, mockContext);

      expect(result1.id).not.toBe(result2.id);
    });
  });
});
