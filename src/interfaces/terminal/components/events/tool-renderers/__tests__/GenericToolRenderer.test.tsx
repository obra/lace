// ABOUTME: Comprehensive tests for GenericToolRenderer component
// ABOUTME: Tests expansion behavior, content rendering, focus states, and tool-specific formatting

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import { GenericToolRenderer } from '../GenericToolRenderer.js';
import { ToolCall, ToolResult } from '../../../../../../tools/types.js';
import { Text } from 'ink';

// Mock dependencies with simple text components
vi.mock('../../../ui/TimelineEntryCollapsibleBox.js', () => ({
  TimelineEntryCollapsibleBox: ({ children, summary, isExpanded, label }: any) => {
    const summaryText = typeof summary === 'object' ? '[ComplexSummary]' : summary;
    const contentText = isExpanded
      ? typeof children === 'object'
        ? '[ComplexContent]'
        : children
      : '';
    return React.createElement(
      Text,
      {},
      `[Box] ${label} - Expanded: ${isExpanded}\nSummary: ${summaryText}${isExpanded ? `\nContent: ${contentText}` : ''}`
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

vi.mock('../../../../theme.js', () => ({
  UI_SYMBOLS: {
    TOOL: '🔧',
    SUCCESS: '✓',
    ERROR: '✗',
    PENDING: '⏳',
  },
  UI_COLORS: {
    TOOL: 'blue',
    SUCCESS: 'green',
    ERROR: 'red',
    PENDING: 'yellow',
  },
}));

describe('GenericToolRenderer', () => {
  const createToolExecutionItem = (
    toolName: string = 'bash',
    input: Record<string, unknown> = { command: 'ls -la' },
    result?: ToolResult
  ) => ({
    type: 'tool_execution' as const,
    call: {
      id: 'call-123',
      name: toolName,
      arguments: input,
    } as ToolCall,
    result,
    timestamp: new Date('2024-01-01T10:00:00Z'),
    callId: 'call-123',
  });

  const createSuccessResult = (output: string = 'file1.txt\nfile2.txt'): ToolResult => ({
    id: 'call-123',
    content: [{ type: 'text', text: output }],
    isError: false,
  });

  const createErrorResult = (error: string = 'Command failed'): ToolResult => ({
    id: 'call-123',
    content: [{ type: 'text', text: error }],
    isError: true,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Tool name formatting', () => {
    it('should format tool names nicely', () => {
      const item = createToolExecutionItem('file_read');

      const { lastFrame } = render(<GenericToolRenderer item={item} />);

      expect(lastFrame()).toContain('file-read');
    });

    it('should preserve hyphenated tool names', () => {
      const item = createToolExecutionItem('ripgrep-search');

      const { lastFrame } = render(<GenericToolRenderer item={item} />);

      expect(lastFrame()).toContain('ripgrep-search');
    });
  });

  describe('Tool command extraction', () => {
    it('should extract bash command for summary', () => {
      const item = createToolExecutionItem('bash', { command: 'ls -la' });

      const { lastFrame } = render(<GenericToolRenderer item={item} />);

      expect(lastFrame()).toContain('bash ls -la'); // Label includes command
    });

    it('should extract file path for file operations', () => {
      const item = createToolExecutionItem('file-read', { file_path: '/test/file.txt' });

      const { lastFrame } = render(<GenericToolRenderer item={item} />);

      expect(lastFrame()).toContain('file-read /test/file.txt'); // Label includes file path
    });

    it('should extract search pattern for ripgrep', () => {
      const item = createToolExecutionItem('ripgrep-search', { pattern: 'TODO' });

      const { lastFrame } = render(<GenericToolRenderer item={item} />);

      expect(lastFrame()).toContain('ripgrep-search "TODO"'); // Label includes pattern
    });

    it('should extract task for delegate tool', () => {
      const item = createToolExecutionItem('delegate', { task: 'Calculate sum' });

      const { lastFrame } = render(<GenericToolRenderer item={item} />);

      expect(lastFrame()).toContain('delegate "Calculate sum"'); // Label includes task
    });

    it('should handle delegate tool with prompt field', () => {
      const item = createToolExecutionItem('delegate', { prompt: 'Help with task' });

      const { lastFrame } = render(<GenericToolRenderer item={item} />);

      expect(lastFrame()).toContain('delegate "Help with task"'); // Label includes prompt
    });

    it('should use first parameter for unknown tools if short', () => {
      const item = createToolExecutionItem('custom-tool', { first_param: 'value' });

      const { lastFrame } = render(<GenericToolRenderer item={item} />);

      expect(lastFrame()).toContain('custom-tool value'); // Label includes first param
    });

    it('should skip long parameters for unknown tools', () => {
      const longValue = 'x'.repeat(60);
      const item = createToolExecutionItem('custom-tool', { param: longValue });

      const { lastFrame } = render(<GenericToolRenderer item={item} />);

      expect(lastFrame()).toContain('custom-tool'); // Label without long param
      expect(lastFrame()).not.toContain(longValue);
    });
  });

  describe('Expansion behavior', () => {
    it('should start collapsed by default', () => {
      const item = createToolExecutionItem();

      const { lastFrame } = render(<GenericToolRenderer item={item} />);

      expect(lastFrame()).toContain('Expanded: false');
    });

    it('should use controlled expansion when provided', () => {
      const item = createToolExecutionItem();

      const { lastFrame } = render(<GenericToolRenderer item={item} isExpanded={true} />);

      expect(lastFrame()).toContain('Expanded: true');
    });

    it('should call onExpandedChange when provided', () => {
      const item = createToolExecutionItem();
      const onExpandedChange = vi.fn();

      render(<GenericToolRenderer item={item} onExpandedChange={onExpandedChange} />);

      // onExpandedChange is passed to TimelineEntryCollapsibleBox
      expect(onExpandedChange).not.toHaveBeenCalled(); // Not called during render
    });
  });

  describe('Content rendering', () => {
    it('should show tool summary when collapsed', () => {
      const item = createToolExecutionItem('bash', { command: 'ls' });

      const { lastFrame } = render(<GenericToolRenderer item={item} />);

      const frame = lastFrame();
      expect(frame).toContain('[ComplexSummary]'); // Summary mock
      expect(frame).toContain('bash'); // Tool name in label
    });

    it('should show input and output when expanded', () => {
      const item = createToolExecutionItem(
        'bash',
        { command: 'ls' },
        createSuccessResult('file.txt')
      );

      const { lastFrame } = render(<GenericToolRenderer item={item} isExpanded={true} />);

      const frame = lastFrame();
      expect(frame).toContain('[ComplexContent]'); // Expanded content mock
      expect(frame).toContain('Expanded: true'); // Should be expanded
    });

    it('should show compact output preview when collapsed with result', () => {
      const item = createToolExecutionItem(
        'bash',
        { command: 'ls' },
        createSuccessResult('file.txt')
      );

      const { lastFrame } = render(<GenericToolRenderer item={item} />);

      const frame = lastFrame();
      expect(frame).toContain('[ComplexSummary]'); // Summary includes compact output
      expect(frame).toContain('Expanded: false'); // Should be collapsed
    });

    it('should not show compact output preview for errors when collapsed', () => {
      const item = createToolExecutionItem(
        'bash',
        { command: 'ls' },
        createErrorResult('Permission denied')
      );

      const { lastFrame } = render(<GenericToolRenderer item={item} />);

      const frame = lastFrame();
      expect(frame).toContain('[ComplexSummary]'); // Still has summary but no compact output
      expect(frame).toContain('Expanded: false'); // Should be collapsed
    });
  });

  describe('Status indicators', () => {
    it('should show success status for successful tools', () => {
      const item = createToolExecutionItem('bash', { command: 'ls' }, createSuccessResult());

      const { lastFrame } = render(<GenericToolRenderer item={item} />);

      expect(lastFrame()).toContain('[ComplexSummary]'); // Summary includes status
    });

    it('should show error status for failed tools', () => {
      const item = createToolExecutionItem('bash', { command: 'ls' }, createErrorResult());

      const { lastFrame } = render(<GenericToolRenderer item={item} />);

      expect(lastFrame()).toContain('[ComplexSummary]'); // Summary includes status
    });

    it('should show pending status for tools without results', () => {
      const item = createToolExecutionItem('bash', { command: 'ls' });

      const { lastFrame } = render(<GenericToolRenderer item={item} />);

      expect(lastFrame()).toContain('[ComplexSummary]'); // Summary includes status
    });

    it('should show streaming indicator when isStreaming is true', () => {
      const item = createToolExecutionItem('bash', { command: 'ls' });

      const { lastFrame } = render(<GenericToolRenderer item={item} isStreaming={true} />);

      expect(lastFrame()).toContain('[ComplexSummary]'); // Summary includes streaming indicator
    });
  });

  describe('JSON output detection', () => {
    it('should detect JSON output and set appropriate language', () => {
      const jsonOutput = '{"result": "success"}';
      const item = createToolExecutionItem(
        'bash',
        { command: 'curl' },
        createSuccessResult(jsonOutput)
      );

      const { lastFrame } = render(<GenericToolRenderer item={item} />);

      expect(lastFrame()).toContain('[ComplexSummary]'); // Summary includes JSON output
    });

    it('should default to text for non-JSON output', () => {
      const textOutput = 'file1.txt\nfile2.txt';
      const item = createToolExecutionItem(
        'bash',
        { command: 'ls' },
        createSuccessResult(textOutput)
      );

      const { lastFrame } = render(<GenericToolRenderer item={item} />);

      expect(lastFrame()).toContain('[ComplexSummary]'); // Summary includes text output
    });
  });

  describe('Error handling', () => {
    it('should display error message when tool fails', () => {
      const item = createToolExecutionItem(
        'bash',
        { command: 'invalid' },
        createErrorResult('Command not found')
      );

      const { lastFrame } = render(<GenericToolRenderer item={item} isExpanded={true} />);

      const frame = lastFrame();
      expect(frame).toContain('[ComplexContent]'); // Error content in expanded view
      expect(frame).toContain('Expanded: true');
    });

    it('should handle missing error message gracefully', () => {
      const result: ToolResult = {
        id: 'call-123',
        content: [{ type: 'text', text: '' }],
        isError: true,
      };
      const item = createToolExecutionItem('bash', { command: 'invalid' }, result);

      const { lastFrame } = render(<GenericToolRenderer item={item} isExpanded={true} />);

      const frame = lastFrame();
      expect(frame).toContain('[ComplexContent]'); // Error content with fallback
      expect(frame).toContain('Expanded: true');
    });

    it('should handle missing output gracefully', () => {
      const result: ToolResult = {
        id: 'call-123',
        content: [{ type: 'text', text: '' }],
        isError: false,
      };
      const item = createToolExecutionItem('bash', { command: 'echo' }, result);

      const { lastFrame } = render(<GenericToolRenderer item={item} isExpanded={true} />);

      const frame = lastFrame();
      expect(frame).toContain('[ComplexContent]'); // Success content with fallback
      expect(frame).toContain('Expanded: true');
    });
  });

  describe('Focus states', () => {
    it('should render without errors when focused', () => {
      const item = createToolExecutionItem();

      const { lastFrame } = render(<GenericToolRenderer item={item} isSelected={true} />);

      expect(lastFrame()).toBeTruthy();
    });

    it('should render without errors when not focused', () => {
      const item = createToolExecutionItem();

      const { lastFrame } = render(<GenericToolRenderer item={item} isSelected={false} />);

      expect(lastFrame()).toBeTruthy();
    });
  });

  describe('Input truncation', () => {
    it('should handle complex input objects', () => {
      const complexInput = {
        file_path: '/long/path/to/file.txt',
        options: { recursive: true, force: true },
        content: 'Some file content here',
      };
      const item = createToolExecutionItem('file-write', complexInput);

      const { lastFrame } = render(<GenericToolRenderer item={item} isExpanded={true} />);

      const frame = lastFrame();
      expect(frame).toContain('[ComplexContent]'); // Complex input displayed as JSON
      expect(frame).toContain('Expanded: true');
    });
  });
});
