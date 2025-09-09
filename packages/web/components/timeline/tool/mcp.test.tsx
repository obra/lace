// ABOUTME: Tests for MCP tool renderer to verify parameter formatting and display
// ABOUTME: Ensures MCP tools show readable parameter summaries instead of raw JSON

import { describe, it, expect } from 'vitest';
import { mcpRenderer } from './mcp';

describe('MCP Tool Renderer', () => {
  describe('getDisplayName', () => {
    it('should format MCP tool names correctly', () => {
      expect(mcpRenderer.getDisplayName?.('filesystem/read_text_file')).toBe(
        'filesystem/read_text_file'
      );
      expect(mcpRenderer.getDisplayName?.('git/commit')).toBe('git/commit');
      expect(mcpRenderer.getDisplayName?.('private-journal/process_thoughts')).toBe(
        'private-journal/process_thoughts'
      );
    });

    it('should handle malformed tool names gracefully', () => {
      expect(mcpRenderer.getDisplayName?.('filesystem')).toBe('filesystem/filesystem'); // No slash
      expect(mcpRenderer.getDisplayName?.('/tool_name')).toBe('unknown/tool_name'); // Leading slash
    });
  });

  describe('getSummary', () => {
    it('should format simple string parameters', () => {
      const args = { path: '/test/file.txt', mode: 'read' };
      const summary = mcpRenderer.getSummary?.(args);
      expect(summary).toBe('path: "/test/file.txt", mode: "read"');
    });

    it('should handle long strings with truncation', () => {
      const longContent = 'a'.repeat(150);
      const args = { content: longContent };
      const summary = mcpRenderer.getSummary?.(args);
      expect(summary).toContain('content: "' + 'a'.repeat(100) + '..."');
    });

    it('should format different parameter types', () => {
      const args = {
        name: 'test',
        count: 42,
        enabled: true,
        tags: ['a', 'b', 'c'],
        metadata: { key: 'value' },
      };
      const summary = mcpRenderer.getSummary?.(args);

      expect(summary).toContain('name: "test"');
      expect(summary).toContain('count: 42');
      expect(summary).toContain('enabled: true');
      expect(summary).toContain('tags: [3 items]');
      expect(summary).toContain('metadata: {1 properties}');
    });

    it('should handle empty or null parameters', () => {
      expect(mcpRenderer.getSummary?.({})).toBe('');
      expect(mcpRenderer.getSummary?.(null)).toBe('null');
      expect(mcpRenderer.getSummary?.(undefined)).toBe('');
    });

    it('should handle non-object parameters', () => {
      expect(mcpRenderer.getSummary?.('simple string')).toBe('simple string');
      expect(mcpRenderer.getSummary?.(123)).toBe('123');
      expect(mcpRenderer.getSummary?.(true)).toBe('true');
    });
  });

  describe('isError', () => {
    it('should correctly identify error statuses', () => {
      expect(mcpRenderer.isError?.({ status: 'failed', content: [] })).toBe(true);
      expect(mcpRenderer.isError?.({ status: 'aborted', content: [] })).toBe(true);
      expect(mcpRenderer.isError?.({ status: 'denied', content: [] })).toBe(true);
      expect(mcpRenderer.isError?.({ status: 'completed', content: [] })).toBe(false);
      expect(mcpRenderer.isError?.({ status: 'pending', content: [] })).toBe(false);
    });
  });

  describe('getIcon', () => {
    it('should return server icon for MCP tools', () => {
      expect(mcpRenderer.getIcon?.()).toBeDefined();
    });
  });
});
