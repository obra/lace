// ABOUTME: Tests for tool renderer factory function
// ABOUTME: Verifies switch-based tool renderer selection and fallback behavior

import { describe, it, expect } from 'vitest';
import { getToolRenderer, hasSpecializedRenderer, getSpecializedToolNames } from '../toolRendererRegistry.js';

describe('getToolRenderer', () => {
  describe('Specialized tool renderers', () => {
    it('should return BashToolRenderer for bash tool', () => {
      const result = getToolRenderer('bash');
      expect(result).toBeTruthy();
      expect(result.name).toBe('BashToolRenderer');
    });

    it('should return DelegateToolRenderer for delegate tool', () => {
      const result = getToolRenderer('delegate');
      expect(result).toBeTruthy();
      expect(result.displayName || result.name).toContain('Delegate');
    });

    it('should return FileEditToolRenderer for file-edit tool', () => {
      const result = getToolRenderer('file-edit');
      expect(result).toBeTruthy();
    });

    it('should return FileListToolRenderer for file-list tool', () => {
      const result = getToolRenderer('file-list');
      expect(result).toBeTruthy();
      expect(result.name).toBe('FileListToolRenderer');
    });

    it('should return FileSearchToolRenderer for file-search tool', () => {
      const result = getToolRenderer('file-search');
      expect(result).toBeTruthy();
    });

    it('should return FileWriteToolRenderer for file-write tool', () => {
      const result = getToolRenderer('file-write');
      expect(result).toBeTruthy();
    });
  });

  describe('Generic tool renderers', () => {
    it('should return GenericToolRenderer for file-read tool', () => {
      const result = getToolRenderer('file-read');
      expect(result).toBeTruthy();
      expect(result.name).toBe('GenericToolRenderer');
    });

    it('should return GenericToolRenderer for ripgrep-search tool', () => {
      const result = getToolRenderer('ripgrep-search');
      expect(result).toBeTruthy();
      expect(result.name).toBe('GenericToolRenderer');
    });

    it('should return GenericToolRenderer for task-manager tool', () => {
      const result = getToolRenderer('task-manager');
      expect(result).toBeTruthy();
      expect(result.name).toBe('GenericToolRenderer');
    });

    it('should return GenericToolRenderer for url-fetch tool', () => {
      const result = getToolRenderer('url-fetch');
      expect(result).toBeTruthy();
      expect(result.name).toBe('GenericToolRenderer');
    });

    it('should return GenericToolRenderer for file-find tool', () => {
      const result = getToolRenderer('file-find');
      expect(result).toBeTruthy();
      expect(result.name).toBe('GenericToolRenderer');
    });

    it('should return GenericToolRenderer for file-insert tool', () => {
      const result = getToolRenderer('file-insert');
      expect(result).toBeTruthy();
      expect(result.name).toBe('GenericToolRenderer');
    });
  });

  describe('Fallback behavior', () => {
    it('should return GenericToolRenderer for unknown tools', () => {
      const result = getToolRenderer('unknown-tool');
      expect(result).toBeTruthy();
      expect(result.name).toBe('GenericToolRenderer');
    });

    it('should return GenericToolRenderer for empty string', () => {
      const result = getToolRenderer('');
      expect(result).toBeTruthy();
      expect(result.name).toBe('GenericToolRenderer');
    });

    it('should return GenericToolRenderer for special characters', () => {
      const result = getToolRenderer('tool@with#special$chars');
      expect(result).toBeTruthy();
      expect(result.name).toBe('GenericToolRenderer');
    });
  });
});

describe('hasSpecializedRenderer', () => {
  it('should return true for tools with specialized renderers', () => {
    expect(hasSpecializedRenderer('bash')).toBe(true);
    expect(hasSpecializedRenderer('delegate')).toBe(true);
    expect(hasSpecializedRenderer('file-edit')).toBe(true);
    expect(hasSpecializedRenderer('file-list')).toBe(true);
    expect(hasSpecializedRenderer('file-search')).toBe(true);
    expect(hasSpecializedRenderer('file-write')).toBe(true);
  });

  it('should return false for tools using generic renderer', () => {
    expect(hasSpecializedRenderer('file-read')).toBe(false);
    expect(hasSpecializedRenderer('ripgrep-search')).toBe(false);
    expect(hasSpecializedRenderer('task-manager')).toBe(false);
    expect(hasSpecializedRenderer('url-fetch')).toBe(false);
    expect(hasSpecializedRenderer('file-find')).toBe(false);
    expect(hasSpecializedRenderer('file-insert')).toBe(false);
  });

  it('should return false for unknown tools', () => {
    expect(hasSpecializedRenderer('unknown-tool')).toBe(false);
    expect(hasSpecializedRenderer('')).toBe(false);
  });
});

describe('getSpecializedToolNames', () => {
  it('should return array of all specialized tool names', () => {
    const result = getSpecializedToolNames();
    expect(result).toEqual([
      'bash',
      'delegate', 
      'file-edit',
      'file-list',
      'file-search',
      'file-write',
    ]);
  });

  it('should return consistent results', () => {
    const result1 = getSpecializedToolNames();
    const result2 = getSpecializedToolNames();
    expect(result1).toEqual(result2);
  });
});
