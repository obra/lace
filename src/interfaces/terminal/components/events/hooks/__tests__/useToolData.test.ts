// ABOUTME: Tests for useToolData hook ensuring consistent data processing across all tools
// ABOUTME: Validates tool input parsing, status indicators, and content detection functionality

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useToolData, ToolExecutionItem } from '../useToolData.js';
import { ToolResult } from '../../../../../../tools/types.js';

// Helper to create mock tool execution items
function createMockItem(
  toolName: string,
  input: Record<string, unknown>,
  result?: ToolResult
): ToolExecutionItem {
  return {
    type: 'tool_execution',
    call: {
      id: 'test-call-id',
      name: toolName,
      arguments: input,
    },
    result,
    timestamp: new Date(),
    callId: 'test-call-id',
  };
}

function createMockResult(text: string, isError = false): ToolResult {
  return {
    content: [{ text }],
    isError,
    metadata: {},
  };
}

describe('useToolData', () => {
  describe('basic tool data extraction', () => {
    it('extracts tool name and input correctly', () => {
      const item = createMockItem('bash', { command: 'ls -la' });
      const { result } = renderHook(() => useToolData(item));
      
      expect(result.current.toolName).toBe('bash');
      expect(result.current.input.command).toBe('ls -la');
    });

    it('determines streaming state correctly', () => {
      const streamingItem = createMockItem('bash', { command: 'ls' });
      const { result: streamingResult } = renderHook(() => useToolData(streamingItem));
      expect(streamingResult.current.isStreaming).toBe(true);
      
      const completedItem = createMockItem('bash', { command: 'ls' }, createMockResult('output'));
      const { result: completedResult } = renderHook(() => useToolData(completedItem));
      expect(completedResult.current.isStreaming).toBe(false);
    });

    it('determines success state correctly', () => {
      const successItem = createMockItem('bash', {}, createMockResult('success output'));
      const { result: successResult } = renderHook(() => useToolData(successItem));
      expect(successResult.current.success).toBe(true);
      
      const errorItem = createMockItem('bash', {}, createMockResult('error output', true));
      const { result: errorResult } = renderHook(() => useToolData(errorItem));
      expect(errorResult.current.success).toBe(false);
    });
  });

  describe('primary info extraction', () => {
    it('extracts bash command with prompt', () => {
      const item = createMockItem('bash', { command: 'echo hello' });
      const { result } = renderHook(() => useToolData(item));
      expect(result.current.primaryInfo).toBe('$ echo hello');
    });

    it('extracts file path for file tools', () => {
      const item = createMockItem('file-read', { path: '/home/test.txt' });
      const { result } = renderHook(() => useToolData(item));
      expect(result.current.primaryInfo).toBe('/home/test.txt');
    });

    it('extracts search pattern for search tools', () => {
      const item = createMockItem('file-search', { pattern: 'TODO' });
      const { result } = renderHook(() => useToolData(item));
      expect(result.current.primaryInfo).toBe('"TODO"');
    });

    it('extracts delegate task', () => {
      const item = createMockItem('delegate', { task: 'Write a function' });
      const { result } = renderHook(() => useToolData(item));
      expect(result.current.primaryInfo).toBe('"Write a function"');
    });

    it('falls back to tool name for unknown tools', () => {
      const item = createMockItem('unknown-tool', {});
      const { result } = renderHook(() => useToolData(item));
      expect(result.current.primaryInfo).toBe('unknown-tool');
    });
  });

  describe('secondary info extraction', () => {
    it('extracts bash description when present', () => {
      const item = createMockItem('bash', { 
        command: 'ls', 
        description: 'List files' 
      });
      const { result } = renderHook(() => useToolData(item));
      expect(result.current.secondaryInfo).toBe(' (List files)');
    });

    it('extracts file-list pattern when present', () => {
      const item = createMockItem('file-list', { 
        path: '/home',
        pattern: '*.js' 
      });
      const { result } = renderHook(() => useToolData(item));
      expect(result.current.secondaryInfo).toBe(' matching "*.js"');
    });

    it('adds delegate indicator', () => {
      const item = createMockItem('delegate', { task: 'test' });
      const { result } = renderHook(() => useToolData(item));
      expect(result.current.secondaryInfo).toBe(' [DELEGATE]');
    });

    it('returns undefined for tools without secondary info', () => {
      const item = createMockItem('bash', { command: 'ls' });
      const { result } = renderHook(() => useToolData(item));
      expect(result.current.secondaryInfo).toBeUndefined();
    });
  });

  describe('status indicators', () => {
    it('shows pending status for streaming tools', () => {
      const item = createMockItem('bash', { command: 'ls' });
      const { result } = renderHook(() => useToolData(item));
      expect(result.current.markerStatus).toBe('pending');
      expect(result.current.statusIcon).toBe('⏳'); // UI_SYMBOLS.PENDING
    });

    it('shows success status for completed successful tools', () => {
      const item = createMockItem('bash', {}, createMockResult('output'));
      const { result } = renderHook(() => useToolData(item));
      expect(result.current.markerStatus).toBe('success');
      expect(result.current.statusIcon).toBe('✓'); // UI_SYMBOLS.SUCCESS
    });

    it('shows error status for failed tools', () => {
      const item = createMockItem('bash', {}, createMockResult('error', true));
      const { result } = renderHook(() => useToolData(item));
      expect(result.current.markerStatus).toBe('error');
      expect(result.current.statusIcon).toBe('✗'); // UI_SYMBOLS.ERROR
    });
  });

  describe('content detection', () => {
    it('detects JSON output correctly', () => {
      const jsonItem = createMockItem('bash', {}, createMockResult('{"test": true}'));
      const { result: jsonResult } = renderHook(() => useToolData(jsonItem));
      expect(jsonResult.current.isJsonOutput).toBe(true);
      
      const textItem = createMockItem('bash', {}, createMockResult('plain text'));
      const { result: textResult } = renderHook(() => useToolData(textItem));
      expect(textResult.current.isJsonOutput).toBe(false);
    });

    it('detects array JSON output', () => {
      const item = createMockItem('bash', {}, createMockResult('[1, 2, 3]'));
      const { result } = renderHook(() => useToolData(item));
      expect(result.current.isJsonOutput).toBe(true);
    });

    it('detects language from file extensions', () => {
      const tsItem = createMockItem('file-read', { path: 'test.ts' });
      const { result: tsResult } = renderHook(() => useToolData(tsItem));
      expect(tsResult.current.detectedLanguage).toBe('typescript');
      
      const pyItem = createMockItem('file-read', { path: 'script.py' });
      const { result: pyResult } = renderHook(() => useToolData(pyItem));
      expect(pyResult.current.detectedLanguage).toBe('python');
      
      const txtItem = createMockItem('file-read', { path: 'readme.txt' });
      const { result: txtResult } = renderHook(() => useToolData(txtItem));
      expect(txtResult.current.detectedLanguage).toBe('text');
    });

    it('defaults to text for bash output', () => {
      const item = createMockItem('bash', {}, createMockResult('output'));
      const { result } = renderHook(() => useToolData(item));
      expect(result.current.detectedLanguage).toBe('text');
    });
  });

  describe('edge cases', () => {
    it('handles empty input gracefully', () => {
      const item = createMockItem('bash', {});
      const { result } = renderHook(() => useToolData(item));
      expect(result.current.primaryInfo).toBe('$ ');
      expect(result.current.output).toBe('');
    });

    it('handles missing result content', () => {
      const item = createMockItem('bash', {}, { content: [], isError: false, metadata: {} });
      const { result } = renderHook(() => useToolData(item));
      expect(result.current.output).toBe('');
      expect(result.current.success).toBe(true);
    });

    it('handles null/undefined values in input', () => {
      const item = createMockItem('file-read', { path: null });
      const { result } = renderHook(() => useToolData(item));
      expect(result.current.primaryInfo).toBe('null');
    });
  });
});