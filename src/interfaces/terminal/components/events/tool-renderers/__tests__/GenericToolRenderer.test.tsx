// ABOUTME: Test suite for GenericToolRenderer component functionality
// ABOUTME: Covers tool name formatting, command extraction, and generic fallback display

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { GenericToolRenderer } from '../GenericToolRenderer.js';
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
        React.createElement(Text, {}, ' [GENERIC]')
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
      
      // Simulate the real useToolData behavior for different tools
      let primaryInfo = '';
      const toolName = call.name;
      
      switch (toolName) {
        case 'bash':
          primaryInfo = `$ ${call.arguments.command || ''}`;
          break;
        case 'file-write':
        case 'file-read':
        case 'file-edit':
          primaryInfo = call.arguments.path || '';
          break;
        case 'ripgrep-search':
          primaryInfo = `"${call.arguments.pattern || ''}" in ${call.arguments.path || 'current directory'}`;
          break;
        case 'delegate':
          primaryInfo = `"${call.arguments.task || call.arguments.prompt || 'Unknown task'}"`;
          break;
        default:
          // For unknown tools, use the first argument value if it's short
          const firstValue = Object.values(call.arguments)[0];
          if (firstValue && typeof firstValue === 'string' && firstValue.length <= 50) {
            primaryInfo = firstValue;
          } else {
            primaryInfo = toolName;
          }
          break;
      }
      
      return {
        toolName,
        primaryInfo,
        secondaryInfo: '',
        success,
        isStreaming,
        statusIcon: success ? '✓' : '✗',
        output,
        language: 'text',
        isEmpty: false,
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

describe('GenericToolRenderer', () => {
  const createToolExecutionItem = (call: ToolCall, result?: ToolResult): ToolExecutionItem => ({
    type: 'tool_execution' as const,
    call,
    result,
    timestamp: new Date(),
    callId: 'test-call-id',
  });

  describe('Tool name formatting', () => {
    it('should format tool names nicely', () => {
      const call: ToolCall = {
        id: 'test-call-1',
        name: 'custom-tool-name',
        arguments: {},
      };
      const item = createToolExecutionItem(call);
      const { lastFrame } = render(<GenericToolRenderer item={item} />);

      const frame = lastFrame();
      expect(frame).toContain('Tool: custom-tool-name');
      expect(frame).toContain('[GENERIC]');
    });
  });

  describe('Tool command extraction', () => {
    it('should extract bash command for summary', () => {
      const call: ToolCall = {
        id: 'test-call-2',
        name: 'bash',
        arguments: { command: 'ls -la' },
      };
      const item = createToolExecutionItem(call);
      const { lastFrame } = render(<GenericToolRenderer item={item} />);

      const frame = lastFrame();
      expect(frame).toContain('$ ls -la');
    });

    it('should extract file path for file operations', () => {
      const call: ToolCall = {
        id: 'test-call-3',
        name: 'file-write',
        arguments: { path: '/test/file.txt', content: 'content' },
      };
      const item = createToolExecutionItem(call);
      const { lastFrame } = render(<GenericToolRenderer item={item} />);

      const frame = lastFrame();
      expect(frame).toContain('/test/file.txt');
    });

    it('should extract search pattern for ripgrep', () => {
      const call: ToolCall = {
        id: 'test-call-4',
        name: 'ripgrep-search',
        arguments: { pattern: 'TODO', path: 'src' },
      };
      const item = createToolExecutionItem(call);
      const { lastFrame } = render(<GenericToolRenderer item={item} />);

      const frame = lastFrame();
      expect(frame).toContain('"TODO" in src');
    });

    it('should extract task for delegate tool', () => {
      const call: ToolCall = {
        id: 'test-call-5',
        name: 'delegate',
        arguments: { task: 'Fix the tests' },
      };
      const item = createToolExecutionItem(call);
      const { lastFrame } = render(<GenericToolRenderer item={item} />);

      const frame = lastFrame();
      expect(frame).toContain('"Fix the tests"');
    });

    it('should handle delegate tool with prompt field', () => {
      const call: ToolCall = {
        id: 'test-call-6',
        name: 'delegate',
        arguments: { prompt: 'Analyze the code' },
      };
      const item = createToolExecutionItem(call);
      const { lastFrame } = render(<GenericToolRenderer item={item} />);

      const frame = lastFrame();
      expect(frame).toContain('"Analyze the code"');
    });

    it('should use first parameter for unknown tools if short', () => {
      const call: ToolCall = {
        id: 'test-call-7',
        name: 'unknown-tool',
        arguments: { someParam: 'short value' },
      };
      const item = createToolExecutionItem(call);
      const { lastFrame } = render(<GenericToolRenderer item={item} />);

      const frame = lastFrame();
      expect(frame).toContain('short value');
    });

    it('should use tool name for unknown tools with long parameters', () => {
      const call: ToolCall = {
        id: 'test-call-8',
        name: 'unknown-tool',
        arguments: { someParam: 'a'.repeat(100) },
      };
      const item = createToolExecutionItem(call);
      const { lastFrame } = render(<GenericToolRenderer item={item} />);

      const frame = lastFrame();
      expect(frame).toContain('unknown-tool');
      expect(frame).not.toContain('a'.repeat(100));
    });
  });
});