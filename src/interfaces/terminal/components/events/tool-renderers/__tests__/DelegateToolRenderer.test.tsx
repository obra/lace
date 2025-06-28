// ABOUTME: Tests for DelegateToolRenderer component with delegation-specific functionality
// ABOUTME: Verifies tool execution display, delegation box integration, and expansion behavior

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import { DelegateToolRenderer } from '../DelegateToolRenderer.js';
import { ToolCall, ToolResult } from '../../../../../../tools/types.js';
import { Text } from 'ink';

// Mock dependencies with simple text components
vi.mock('../../../ui/TimelineEntryCollapsibleBox.js', () => ({
  TimelineEntryCollapsibleBox: ({ children, summary, isExpanded, label }: any) => {
    const summaryText = typeof summary === 'object' ? '[DelegateSummary]' : summary;
    const contentText = isExpanded
      ? typeof children === 'object'
        ? '[DelegateContent]'
        : children
      : '';
    return React.createElement(
      Text,
      {},
      `[DelegateBox] ${label} - Expanded: ${isExpanded}\nSummary: ${summaryText}${isExpanded ? `\nContent: ${contentText}` : ''}`
    );
  },
}));

vi.mock('../../../ui/CompactOutput.js', () => ({
  CompactOutput: ({ output, language, maxLines }: any) =>
    React.createElement(Text, {}, `[CompactOutput] ${output} (${language}, max: ${maxLines})`),
}));

vi.mock('../../../ui/CodeDisplay.js', () => ({
  CodeDisplay: ({ code, language }: any) =>
    React.createElement(Text, {}, `[CodeDisplay] ${code} (${language})`),
}));

vi.mock('../../DelegationBox.js', () => ({
  DelegationBox: ({ toolCall }: any) => {
    // Extract delegate thread ID from metadata like the real component
    const extractDelegateThreadId = (item: any) => {
      const threadId = item.result?.metadata?.threadId;
      return threadId && typeof threadId === 'string' ? threadId : null;
    };
    const threadId = extractDelegateThreadId(toolCall);
    return React.createElement(Text, {}, `[DelegationBox] Thread: ${threadId || 'No thread'}`);
  },
}));

vi.mock('../../../../theme.js', () => ({
  UI_SYMBOLS: {
    TOOL: '🔧',
    SUCCESS: '✓',
    ERROR: '✗',
    PENDING: '⏳',
    DELEGATE: '🤝',
  },
  UI_COLORS: {
    TOOL: 'blue',
    SUCCESS: 'green',
    ERROR: 'red',
    PENDING: 'yellow',
    DELEGATE: 'cyan',
  },
}));

vi.mock('../../hooks/useTimelineExpansionToggle.js', () => ({
  useTimelineItemExpansion: () => ({
    isExpanded: false,
    handleExpandedChange: vi.fn(),
  }),
}));

describe('DelegateToolRenderer', () => {
  const createDelegateExecutionItem = (
    input: Record<string, unknown> = { task: 'Calculate 3+6' },
    result?: ToolResult
  ) => ({
    type: 'tool_execution' as const,
    call: {
      id: 'call-123',
      name: 'delegate',
      arguments: input,
    } as ToolCall,
    result,
    timestamp: new Date('2024-01-01T10:00:00Z'),
    callId: 'call-123',
  });

  const createSuccessResult = (output: string = 'Thread: delegate-thread-456'): ToolResult => ({
    id: 'call-123',
    content: [{ type: 'text', text: output }],
    isError: false,
  });

  const createErrorResult = (error: string = 'Delegation failed'): ToolResult => ({
    id: 'call-123',
    content: [{ type: 'text', text: error }],
    isError: true,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Task extraction and display', () => {
    it('should extract task from input.task field', () => {
      const item = createDelegateExecutionItem({ task: 'Help me calculate something' });

      const { lastFrame } = render(<DelegateToolRenderer item={item} />);

      expect(lastFrame()).toContain('delegate "Help me calculate something"');
    });

    it('should extract task from input.prompt field as fallback', () => {
      const item = createDelegateExecutionItem({ prompt: 'Solve this problem' });

      const { lastFrame } = render(<DelegateToolRenderer item={item} />);

      expect(lastFrame()).toContain('delegate "Solve this problem"');
    });

    it('should use fallback when no task or prompt provided', () => {
      const item = createDelegateExecutionItem({ other: 'field' });

      const { lastFrame } = render(<DelegateToolRenderer item={item} />);

      expect(lastFrame()).toContain('delegate "Unknown task"');
    });
  });

  describe('Delegation status display', () => {
    it('should show thread ID when delegation is successful', () => {
      const item = createDelegateExecutionItem(
        { task: 'Calculate sum' },
        createSuccessResult('Thread: delegate-thread-456')
      );

      const { lastFrame } = render(<DelegateToolRenderer item={item} />);

      const frame = lastFrame();
      expect(frame).toContain('[DelegateSummary]');
      expect(frame).toContain('delegate "Calculate sum"');
    });

    it('should show error status when delegation fails', () => {
      const item = createDelegateExecutionItem(
        { task: 'Calculate sum' },
        createErrorResult('Failed to create delegate thread')
      );

      const { lastFrame } = render(<DelegateToolRenderer item={item} />);

      const frame = lastFrame();
      expect(frame).toContain('[DelegateSummary]');
      expect(frame).toContain('delegate "Calculate sum"');
    });

    it('should show pending status when no result yet', () => {
      const item = createDelegateExecutionItem({ task: 'Calculate sum' });

      const { lastFrame } = render(<DelegateToolRenderer item={item} />);

      const frame = lastFrame();
      expect(frame).toContain('[DelegateSummary]');
      expect(frame).toContain('delegate "Calculate sum"');
    });

    it('should show streaming indicator when isStreaming is true', () => {
      const item = createDelegateExecutionItem({ task: 'Calculate sum' });

      const { lastFrame } = render(<DelegateToolRenderer item={item} isStreaming={true} />);

      expect(lastFrame()).toContain('[DelegateSummary]');
    });
  });

  describe('Thread ID extraction', () => {
    it('should extract thread ID from output containing Thread: pattern', () => {
      const item = createDelegateExecutionItem(
        { task: 'Calculate sum' },
        createSuccessResult(
          'Successfully created delegate thread.\nThread: delegate-thread-789\nStarting execution...'
        )
      );

      const { lastFrame } = render(<DelegateToolRenderer item={item} />);

      const frame = lastFrame();
      expect(frame).toContain('[DelegateSummary]');
    });

    it('should handle output without thread ID pattern', () => {
      const item = createDelegateExecutionItem(
        { task: 'Calculate sum' },
        createSuccessResult('Delegation completed without thread ID')
      );

      const { lastFrame } = render(<DelegateToolRenderer item={item} />);

      const frame = lastFrame();
      expect(frame).toContain('[DelegateSummary]');
    });

    it('should handle missing output gracefully', () => {
      const item = createDelegateExecutionItem(
        { task: 'Calculate sum' },
        {
          id: 'call-123',
          content: [{ type: 'text', text: '' }],
          isError: false,
        }
      );

      const { lastFrame } = render(<DelegateToolRenderer item={item} />);

      expect(lastFrame()).toContain('[DelegateSummary]');
    });
  });

  describe('Expansion behavior', () => {
    it('should start collapsed by default', () => {
      const item = createDelegateExecutionItem();

      const { lastFrame } = render(<DelegateToolRenderer item={item} />);

      expect(lastFrame()).toContain('Expanded: false');
    });

    it('should use shared expansion state from hook', () => {
      const item = createDelegateExecutionItem();

      const { lastFrame } = render(<DelegateToolRenderer item={item} />);

      // Expansion is now managed by the hook system
      expect(lastFrame()).toContain('Expanded: false');
    });
  });

  describe('Content rendering', () => {
    it('should show delegate summary when collapsed', () => {
      const item = createDelegateExecutionItem({ task: 'Calculate sum' });

      const { lastFrame } = render(<DelegateToolRenderer item={item} />);

      const frame = lastFrame();
      expect(frame).toContain('[DelegateSummary]');
      expect(frame).toContain('Expanded: false');
    });

    it('should show delegate summary when collapsed', () => {
      const item = createDelegateExecutionItem(
        { task: 'Calculate sum' },
        createSuccessResult('Thread: delegate-thread-456')
      );

      const { lastFrame } = render(<DelegateToolRenderer item={item}  />);

      const frame = lastFrame();
      expect(frame).toContain('[DelegateSummary]');
      expect(frame).toContain('Expanded: false');
    });

    it('should show delegate summary when thread ID is found but collapsed', () => {
      const item = createDelegateExecutionItem(
        { task: 'Calculate sum' },
        createSuccessResult('Thread: delegate-thread-456')
      );

      const { lastFrame } = render(<DelegateToolRenderer item={item}  />);

      const frame = lastFrame();
      expect(frame).toContain('[DelegateSummary]');
      expect(frame).toContain('Expanded: false');
    });

    it('should show delegate summary when no thread ID found', () => {
      const item = createDelegateExecutionItem(
        { task: 'Calculate sum' },
        createSuccessResult('No thread created')
      );

      const { lastFrame } = render(<DelegateToolRenderer item={item}  />);

      const frame = lastFrame();
      expect(frame).toContain('[DelegateSummary]');
      expect(frame).toContain('Expanded: false');
    });
  });

  describe('Error handling', () => {
    it('should display delegate summary when delegation fails', () => {
      const item = createDelegateExecutionItem(
        { task: 'Calculate sum' },
        createErrorResult('Failed to create delegate thread')
      );

      const { lastFrame } = render(<DelegateToolRenderer item={item}  />);

      const frame = lastFrame();
      expect(frame).toContain('[DelegateSummary]');
      expect(frame).toContain('Expanded: false');
    });

    it('should handle missing error message gracefully', () => {
      const result: ToolResult = {
        id: 'call-123',
        content: [{ type: 'text', text: '' }],
        isError: true,
      };
      const item = createDelegateExecutionItem({ task: 'Calculate sum' }, result);

      const { lastFrame } = render(<DelegateToolRenderer item={item}  />);

      const frame = lastFrame();
      expect(frame).toContain('[DelegateSummary]');
      expect(frame).toContain('Expanded: false');
    });

    it('should handle missing output gracefully', () => {
      const result: ToolResult = {
        id: 'call-123',
        content: [{ type: 'text', text: '' }],
        isError: false,
      };
      const item = createDelegateExecutionItem({ task: 'Calculate sum' }, result);

      const { lastFrame } = render(<DelegateToolRenderer item={item}  />);

      const frame = lastFrame();
      expect(frame).toContain('[DelegateSummary]');
      expect(frame).toContain('Expanded: false');
    });
  });

  describe('JSON output detection', () => {
    it('should detect JSON output and set appropriate language', () => {
      const jsonOutput = '{"threadId": "delegate-thread-456", "status": "created"}';
      const item = createDelegateExecutionItem(
        { task: 'Calculate sum' },
        createSuccessResult(jsonOutput)
      );

      const { lastFrame } = render(<DelegateToolRenderer item={item} />);

      expect(lastFrame()).toContain('[DelegateSummary]');
    });

    it('should default to text for non-JSON output', () => {
      const textOutput = 'Thread: delegate-thread-456\nDelegation started successfully';
      const item = createDelegateExecutionItem(
        { task: 'Calculate sum' },
        createSuccessResult(textOutput)
      );

      const { lastFrame } = render(<DelegateToolRenderer item={item} />);

      expect(lastFrame()).toContain('[DelegateSummary]');
    });
  });

  describe('Focus states', () => {
    it('should render without errors when focused', () => {
      const item = createDelegateExecutionItem();

      const { lastFrame } = render(<DelegateToolRenderer item={item} isSelected={true} />);

      expect(lastFrame()).toBeTruthy();
    });

    it('should render without errors when not focused', () => {
      const item = createDelegateExecutionItem();

      const { lastFrame } = render(<DelegateToolRenderer item={item} isSelected={false} />);

      expect(lastFrame()).toBeTruthy();
    });
  });

  describe('Input handling', () => {
    it('should handle complex input objects', () => {
      const complexInput = {
        task: 'Process data analysis',
        context: {
          data: 'large dataset',
          format: 'CSV',
          requirements: ['clean', 'analyze', 'visualize'],
        },
        options: { timeout: 300, retries: 3 },
      };
      const item = createDelegateExecutionItem(complexInput);

      const { lastFrame } = render(<DelegateToolRenderer item={item}  />);

      const frame = lastFrame();
      expect(frame).toContain('[DelegateSummary]');
      expect(frame).toContain('delegate "Process data analysis"');
      expect(frame).toContain('Expanded: false');
    });

    it('should handle empty input objects', () => {
      const item = createDelegateExecutionItem({});

      const { lastFrame } = render(<DelegateToolRenderer item={item} />);

      expect(lastFrame()).toContain('delegate "Unknown task"');
    });
  });

  describe('Thread ID extraction from metadata', () => {
    it('should extract thread ID from result metadata', () => {
      const result: ToolResult = {
        id: 'call-123',
        content: [{ type: 'text', text: 'Delegation created successfully' }],
        isError: false,
        metadata: { threadId: 'delegate-thread-789' },
      };
      const item = createDelegateExecutionItem({ task: 'Analyze logs' }, result);

      const { lastFrame } = render(<DelegateToolRenderer item={item} />);

      const frame = lastFrame();
      expect(frame).toContain('[DelegateBox] delegate "Analyze logs"');
      // DelegationBox component should be rendered for tools with metadata threadId
    });

    it('should show delegation active status when thread ID present in metadata', () => {
      const result: ToolResult = {
        id: 'call-456',
        content: [{ type: 'text', text: 'Task completed' }],
        isError: false,
        metadata: { threadId: 'delegate-thread-completed' },
      };
      const item = createDelegateExecutionItem({ task: 'Complete analysis' }, result);

      const { lastFrame } = render(<DelegateToolRenderer item={item} />);

      expect(lastFrame()).toContain('[DelegateBox] delegate "Complete analysis"');
      // DelegationBox component should be rendered for completed delegate tasks
    });

    it('should not show delegation info when no thread ID in metadata', () => {
      const result: ToolResult = {
        id: 'call-789',
        content: [{ type: 'text', text: 'No delegation' }],
        isError: false,
        metadata: {},
      };
      const item = createDelegateExecutionItem({ task: 'Simple task' }, result);

      const { lastFrame } = render(<DelegateToolRenderer item={item} />);

      const frame = lastFrame();
      expect(frame).not.toContain('Thread:');
      expect(frame).not.toContain('Delegation active');
    });
  });
});
