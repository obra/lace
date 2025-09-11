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
    it('should return empty string to keep title clean', () => {
      const args = { path: '/test/file.txt', mode: 'read' };
      const summary = mcpRenderer.getSummary?.(args);
      expect(summary).toBe('');
    });

    it('should return empty string for all parameter types', () => {
      expect(mcpRenderer.getSummary?.({})).toBe('');
      expect(mcpRenderer.getSummary?.(null)).toBe('');
      expect(mcpRenderer.getSummary?.(undefined)).toBe('');
      expect(mcpRenderer.getSummary?.('simple string')).toBe('');
      expect(mcpRenderer.getSummary?.(123)).toBe('');
      expect(mcpRenderer.getSummary?.(true)).toBe('');
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
