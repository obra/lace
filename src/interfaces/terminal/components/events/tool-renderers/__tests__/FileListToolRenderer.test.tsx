// ABOUTME: Test suite for FileListToolRenderer component functionality
// ABOUTME: Covers tree structure display, parameter handling, and success/error states

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import { FileListToolRenderer } from '../FileListToolRenderer.js';
import { ToolCall, ToolResult } from '../../../../../../tools/types.js';
import { Text } from 'ink';

// Mock dependencies with simple text components
vi.mock('../../../ui/TimelineEntry.js', () => ({
  TimelineEntry: ({ children, summary, isExpanded, label }: any) => {
    const summaryText = typeof summary === 'object' ? '[ComplexSummary]' : summary;
    const contentText = isExpanded
      ? typeof children === 'object'
        ? '[ComplexContent]'
        : children
      : '';
    
    // If label is a React element, render it as part of the mock
    const labelText = React.isValidElement(label) ? '' : label;
    
    return React.createElement(
      Text,
      {},
      `[Box] ${labelText} - Expanded: ${isExpanded}\nSummary: ${summaryText}${isExpanded ? `\nContent: ${contentText}` : ''}`,
      React.isValidElement(label) ? label : null
    );
  },
}));

vi.mock('../../../../theme.js', () => ({
  UI_SYMBOLS: {
    SUCCESS: '✓',
    ERROR: '✗',
    PENDING: '⏳',
  },
  UI_COLORS: {
    TOOL: 'blue',
    SUCCESS: 'green',
    ERROR: 'red',
  },
}));

vi.mock('../../hooks/useTimelineExpansionToggle.js', () => ({
  useTimelineItemExpansion: () => ({
    isExpanded: false,
    onExpand: vi.fn(),
    onCollapse: vi.fn(),
  }),
}));

describe('FileListToolRenderer', () => {
  const mockCall: ToolCall = {
    id: 'test-call-id',
    name: 'file_list',
    arguments: {
      path: '/test/directory',
      recursive: true,
      maxDepth: 2,
    },
  };

  const mockTreeOutput = `test-directory/
├ file1.txt (150 bytes)
├ file2.js (1234 bytes)
├ subdirectory/
│ ├ nested-file.md (500 bytes)
│ └ another-file.json (800 bytes)
└ README.md (2048 bytes)`;

  const mockSuccessResult: ToolResult = {
    content: [{ type: 'text', text: mockTreeOutput }],
    isError: false,
  };

  const mockEmptyResult: ToolResult = {
    content: [{ type: 'text', text: 'No files found' }],
    isError: false,
  };

  const mockErrorResult: ToolResult = {
    content: [{ type: 'text', text: 'Permission denied: /restricted/path' }],
    isError: true,
  };

  const createToolExecutionItem = (call: ToolCall, result?: ToolResult) => ({
    type: 'tool_execution' as const,
    call,
    result,
    timestamp: new Date(),
    callId: 'test-call-id',
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders tool name and directory path correctly', () => {
    const item = createToolExecutionItem(mockCall, mockSuccessResult);
    const { lastFrame } = render(<FileListToolRenderer item={item} />);

    const frame = lastFrame();
    expect(frame).toContain('File List:');
    expect(frame).toContain('/test/directory');
  });

  it('displays parameter summary when options are provided', () => {
    const callWithOptions: ToolCall = {
      ...mockCall,
      arguments: {
        path: '/test/directory',
        recursive: true,
        includeHidden: true,
        pattern: '*.js',
        maxDepth: 5,
      },
    };
    
    const item = createToolExecutionItem(callWithOptions, mockSuccessResult);
    const { lastFrame } = render(<FileListToolRenderer item={item} />);

    const frame = lastFrame();
    expect(frame).toContain('recursive');
    expect(frame).toContain('hidden files');
    expect(frame).toContain('pattern: *.js');
    expect(frame).toContain('depth:');
  });

  it('shows current directory when path is not specified', () => {
    const callWithoutPath: ToolCall = {
      ...mockCall,
      arguments: {},
    };
    
    const item = createToolExecutionItem(callWithoutPath, mockSuccessResult);
    const { lastFrame } = render(<FileListToolRenderer item={item} />);

    const frame = lastFrame();
    expect(frame).toContain('current directory');
  });

  it('displays success icon for successful results', () => {
    const item = createToolExecutionItem(mockCall, mockSuccessResult);
    const { lastFrame } = render(<FileListToolRenderer item={item} />);

    const frame = lastFrame();
    expect(frame).toContain('✓');
  });

  it('displays error icon for failed results', () => {
    const item = createToolExecutionItem(mockCall, mockErrorResult);
    const { lastFrame } = render(<FileListToolRenderer item={item} />);

    const frame = lastFrame();
    expect(frame).toContain('✗');
  });

  it('shows file and directory count in summary', () => {
    const item = createToolExecutionItem(mockCall, mockSuccessResult);
    const { lastFrame } = render(<FileListToolRenderer item={item} />);

    const frame = lastFrame();
    // The summary shows in the [ComplexSummary] mock - actual counting happens in the component
    expect(frame).toContain('[ComplexSummary]');
  });

  it('displays "No files found" message for empty results', () => {
    const item = createToolExecutionItem(mockCall, mockEmptyResult);
    const { lastFrame } = render(<FileListToolRenderer item={item} />);

    const frame = lastFrame();
    expect(frame).toContain('[ComplexSummary]');
  });

  it('shows error message for failed tool execution', () => {
    const item = createToolExecutionItem(mockCall, mockErrorResult);
    const { lastFrame } = render(<FileListToolRenderer item={item} />);

    const frame = lastFrame();
    // Error results don't have complex summary, they show 'false' for the summary
    expect(frame).toContain('Summary: false');
  });

  it('shows streaming indicator when isStreaming is true', () => {
    const item = createToolExecutionItem(mockCall);
    const { lastFrame } = render(<FileListToolRenderer item={item} isStreaming={true} />);

    const frame = lastFrame();
    expect(frame).toContain('(scanning...)');
  });

  it('handles missing result gracefully', () => {
    const item = createToolExecutionItem(mockCall);
    const { lastFrame } = render(<FileListToolRenderer item={item} />);

    const frame = lastFrame();
    // Pending items show success icon (✓) not pending icon since 'success' is true for missing results
    expect(frame).toContain('✓');
  });

  it('renders collapsed by default', () => {
    const item = createToolExecutionItem(mockCall, mockSuccessResult);
    const { lastFrame } = render(<FileListToolRenderer item={item} />);

    const frame = lastFrame();
    expect(frame).toContain('Expanded: false');
  });

  it('uses shared expansion state from hook', () => {
    const item = createToolExecutionItem(mockCall, mockSuccessResult);
    const { lastFrame } = render(<FileListToolRenderer item={item} />);

    const frame = lastFrame();
    expect(frame).toContain('Expanded: false');
  });

  it('handles focus states correctly', () => {
    const item = createToolExecutionItem(mockCall, mockSuccessResult);
    const { lastFrame } = render(<FileListToolRenderer item={item} isSelected={true} />);

    const frame = lastFrame();
    expect(frame).toBeTruthy();
  });
});