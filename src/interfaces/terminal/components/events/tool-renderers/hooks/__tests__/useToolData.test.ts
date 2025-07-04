// ABOUTME: Comprehensive tests for useToolData hook - data extraction and parsing layer
// ABOUTME: Tests tool-specific data extraction patterns and consistent data structure formatting

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { ToolCall, ToolResult } from '../../../../../../../tools/types.js';
import { useToolData } from '../useToolData.js';

// Helper to create mock tool execution items
function createToolExecutionItem(
  toolName: string,
  args: Record<string, unknown>,
  result?: ToolResult
) {
  const call: ToolCall = {
    id: 'test-call-id',
    name: toolName,
    arguments: args,
  };

  return {
    type: 'tool_execution' as const,
    call,
    result,
    timestamp: new Date(),
    callId: 'test-call-id',
  };
}

// Helper to create mock tool results
function createToolResult(content: string, isError = false): ToolResult {
  return {
    content: [{ type: 'text', text: content }],
    isError,
  };
}

describe('useToolData', () => {
  describe('bash tool data extraction', () => {
    it('should extract basic bash command info', () => {
      const item = createToolExecutionItem('bash', {
        command: 'ls -la',
        description: 'List directory contents',
      });

      const { result } = renderHook(() => useToolData(item));

      expect(result.current.primaryInfo).toBe('$ ls -la');
      expect(result.current.secondaryInfo).toBe('List directory contents');
      expect(result.current.toolName).toBe('bash');
      expect(result.current.isStreaming).toBe(true);
    });

    it('should handle bash command without description', () => {
      const item = createToolExecutionItem('bash', {
        command: 'pwd',
      });

      const { result } = renderHook(() => useToolData(item));

      expect(result.current.primaryInfo).toBe('$ pwd');
      expect(result.current.secondaryInfo).toBe('');
    });

    it('should parse bash output correctly', () => {
      const bashResult = createToolResult('total 48\ndrwxr-xr-x 3 user staff 96 Dec 1 10:00 src');
      const item = createToolExecutionItem('bash', { command: 'ls -la' }, bashResult);

      const { result } = renderHook(() => useToolData(item));

      expect(result.current.success).toBe(true);
      expect(result.current.output).toBe('total 48\ndrwxr-xr-x 3 user staff 96 Dec 1 10:00 src');
      expect(result.current.statusIcon).toBe('✓');
      expect(result.current.isStreaming).toBe(false);
    });
  });

  describe('file-write tool data extraction', () => {
    it('should extract file write path info', () => {
      const item = createToolExecutionItem('file-write', {
        path: '/path/to/file.txt',
        content: 'Hello world',
      });

      const { result } = renderHook(() => useToolData(item));

      expect(result.current.primaryInfo).toBe('/path/to/file.txt');
      expect(result.current.toolName).toBe('file-write');
    });

    it('should parse file write result with character count', () => {
      const writeResult = createToolResult('Successfully wrote 11 characters to /path/to/file.txt');
      const item = createToolExecutionItem('file-write', { 
        path: '/path/to/file.txt',
        content: 'Hello world'
      }, writeResult);

      const { result } = renderHook(() => useToolData(item));

      expect(result.current.success).toBe(true);
      expect(result.current.stats).toBe('11 characters');
    });
  });

  describe('file-search tool data extraction', () => {
    it('should extract search pattern and path', () => {
      const item = createToolExecutionItem('ripgrep-search', {
        pattern: 'function.*test',
        path: './src',
        caseSensitive: true,
      });

      const { result } = renderHook(() => useToolData(item));

      expect(result.current.primaryInfo).toBe('"function.*test" in ./src');
      expect(result.current.secondaryInfo).toBe(' (case-sensitive)');
    });

    it('should parse search results with match counts', () => {
      const searchResult = createToolResult('Found 5 matches\nsrc/test.ts:10:function test() {\nsrc/app.ts:15:function test2() {');
      const item = createToolExecutionItem('ripgrep-search', { 
        pattern: 'function',
        path: './src'
      }, searchResult);

      const { result } = renderHook(() => useToolData(item));

      expect(result.current.success).toBe(true);
      expect(result.current.stats).toBe('5 matches across 2 files');
    });

    it('should handle no matches found', () => {
      const searchResult = createToolResult('No matches found');
      const item = createToolExecutionItem('ripgrep-search', { 
        pattern: 'nonexistent',
        path: './src'
      }, searchResult);

      const { result } = renderHook(() => useToolData(item));

      expect(result.current.success).toBe(true);
      expect(result.current.stats).toBe('No matches found');
      expect(result.current.isEmpty).toBe(true);
    });
  });

  describe('file-edit tool data extraction', () => {
    it('should extract edit file path', () => {
      const item = createToolExecutionItem('file-edit', {
        path: '/path/to/file.js',
        old_text: 'const x = 1;',
        new_text: 'const x = 2;',
      });

      const { result } = renderHook(() => useToolData(item));

      expect(result.current.primaryInfo).toBe('/path/to/file.js');
    });

    it('should parse edit result with line counts', () => {
      const editResult = createToolResult('Successfully replaced text in /path/to/file.js (3 lines → 4 lines)');
      const item = createToolExecutionItem('file-edit', { 
        path: '/path/to/file.js',
        old_text: 'const x = 1;\nconst y = 2;',
        new_text: 'const x = 1;\nconst y = 2;\nconst z = 3;'
      }, editResult);

      const { result } = renderHook(() => useToolData(item));

      expect(result.current.success).toBe(true);
      expect(result.current.stats).toBe('1 replacement (3 → 4 lines)');
    });
  });

  describe('file-list tool data extraction', () => {
    it('should extract list path info', () => {
      const item = createToolExecutionItem('file-list', {
        path: './src',
        pattern: '*.ts',
      });

      const { result } = renderHook(() => useToolData(item));

      expect(result.current.primaryInfo).toBe('./src');
      expect(result.current.secondaryInfo).toBe(' (*.ts)');
    });
  });

  describe('delegate tool data extraction', () => {
    it('should extract delegate task from input', () => {
      const item = createToolExecutionItem('delegate', {
        task: 'Write a test for the new feature',
      });

      const { result } = renderHook(() => useToolData(item));

      expect(result.current.primaryInfo).toBe('"Write a test for the new feature"');
      expect(result.current.secondaryInfo).toBe('[DELEGATE]');
    });

    it('should handle delegate with prompt instead of task', () => {
      const item = createToolExecutionItem('delegate', {
        prompt: 'Fix the bug in authentication',
      });

      const { result } = renderHook(() => useToolData(item));

      expect(result.current.primaryInfo).toBe('"Fix the bug in authentication"');
    });
  });

  describe('generic tool data extraction', () => {
    it('should handle unknown tool types with fallback', () => {
      const item = createToolExecutionItem('unknown-tool', {
        someParam: 'value',
      });

      const { result } = renderHook(() => useToolData(item));

      expect(result.current.primaryInfo).toBe('unknown-tool');
      expect(result.current.toolName).toBe('unknown-tool');
    });
  });

  describe('error handling', () => {
    it('should handle tool errors correctly', () => {
      const errorResult = createToolResult('Permission denied', true);
      const item = createToolExecutionItem('bash', { command: 'cat /etc/shadow' }, errorResult);

      const { result } = renderHook(() => useToolData(item));

      expect(result.current.success).toBe(false);
      expect(result.current.output).toBe('Permission denied');
      expect(result.current.statusIcon).toBe('✗');
    });
  });

  describe('content detection', () => {
    it('should detect JSON content', () => {
      const jsonResult = createToolResult('{"key": "value", "array": [1, 2, 3]}');
      const item = createToolExecutionItem('bash', { command: 'cat config.json' }, jsonResult);

      const { result } = renderHook(() => useToolData(item));

      expect(result.current.language).toBe('json');
    });

    it('should detect text content by default', () => {
      const textResult = createToolResult('Hello world\nThis is text');
      const item = createToolExecutionItem('bash', { command: 'echo "Hello"' }, textResult);

      const { result } = renderHook(() => useToolData(item));

      expect(result.current.language).toBe('text');
    });
  });
});