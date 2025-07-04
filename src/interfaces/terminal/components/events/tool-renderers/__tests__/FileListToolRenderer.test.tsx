// ABOUTME: Test suite for FileListToolRenderer component functionality
// ABOUTME: Covers tree structure display, parameter handling, and success/error states

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import { FileListToolRenderer } from '../FileListToolRenderer.js';
import { ToolCall, ToolResult } from '../../../../../../tools/types.js';
import type { ToolExecutionItem } from '../hooks/useToolData.js';

import { Text, Box } from 'ink';

// Mock the new architecture components
vi.mock('../components/ToolDisplay.js', () => ({
  ToolDisplay: ({ toolData, toolState, components }: any) => {
    return React.createElement(
      Box,
      { flexDirection: 'column' },
      // Render header
      React.createElement(
        Box,
        {},
        React.createElement(Text, {}, `Tool: ${toolData.toolName}`),
        React.createElement(Text, {}, ` - ${toolData.primaryInfo}`),
        toolData.secondaryInfo && React.createElement(Text, {}, toolData.secondaryInfo),
        React.createElement(Text, {}, ` ${toolData.statusIcon}`),
        toolData.isStreaming && React.createElement(Text, {}, ' (running...)'),
        toolData.stats && React.createElement(Text, {}, ` - ${toolData.stats}`)
      ),
      // Render preview when collapsed
      !toolState.isExpanded && components?.preview,
      // Render content when expanded
      toolState.isExpanded && components?.content
    );
  },
}));

vi.mock('../hooks/useToolData.js', () => {
  return {
    useToolData: (item: any) => {
      const { call, result } = item;
      const success = result ? !result.isError : true;
      const isStreaming = !result;
      const output = result?.content?.[0]?.text || '';
      
      return {
        toolName: 'file-list',
        primaryInfo: call.arguments.path || 'current directory',
        secondaryInfo: call.arguments.recursive ? ' (recursive)' : '',
        success,
        isStreaming,
        statusIcon: success ? '✓' : '✗',
        output,
        language: 'text',
        isEmpty: output === 'No files found',
        stats: '',
        input: call.arguments,
        result,
      };
    },
    ToolExecutionItem: {},
  };
});

vi.mock('../hooks/useToolState.js', () => ({
  useToolState: (isSelected: boolean, onToggle?: () => void) => ({
    isExpanded: false,
    onExpand: vi.fn(),
    onCollapse: vi.fn(),
    handleExpandedChange: vi.fn(),
  }),
}));

// Keep the limitLines utility
vi.mock('../useToolRenderer.js', () => ({
  limitLines: (text: string, maxLines: number) => {
    const lines = text.split('\n');
    return {
      lines: lines.slice(0, maxLines),
      truncated: lines.length > maxLines,
      remaining: Math.max(0, lines.length - maxLines),
    };
  },
}));

describe('FileListToolRenderer', () => {
  const mockCall: ToolCall = {
    id: 'test-call-1',
    name: 'file-list',
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

  it('renders basic file list information', () => {
    const item = createToolExecutionItem(mockCall, mockSuccessResult);
    const { lastFrame } = render(<FileListToolRenderer item={item} />);

    const frame = lastFrame();
    expect(frame).toContain('Tool: file-list');
    expect(frame).toContain('/test/directory');
    expect(frame).toContain('(recursive)');
    expect(frame).toContain('✓');
  });

  it('shows directory tree preview when collapsed', () => {
    const item = createToolExecutionItem(mockCall, mockSuccessResult);
    const { lastFrame } = render(<FileListToolRenderer item={item} />);

    const frame = lastFrame();
    expect(frame).toContain('test-directory/');
    expect(frame).toContain('├ file1.txt (150 bytes)');
  });

  it('handles empty directory results', () => {
    const item = createToolExecutionItem(mockCall, mockEmptyResult);
    const { lastFrame } = render(<FileListToolRenderer item={item} />);

    const frame = lastFrame();
    expect(frame).toContain('No files found');
  });

  it('handles error results', () => {
    const item = createToolExecutionItem(mockCall, mockErrorResult);
    const { lastFrame } = render(<FileListToolRenderer item={item} />);

    const frame = lastFrame();
    expect(frame).toContain('✗');
  });

  it('shows streaming indicator when isStreaming is true', () => {
    const item = createToolExecutionItem(mockCall);
    const { lastFrame } = render(<FileListToolRenderer item={item} isStreaming={true} />);

    const frame = lastFrame();
    expect(frame).toContain('(running...)');
  });

  it('handles missing result gracefully', () => {
    const item = createToolExecutionItem(mockCall);
    const { lastFrame } = render(<FileListToolRenderer item={item} />);

    const frame = lastFrame();
    expect(frame).toContain('✓');
  });
});