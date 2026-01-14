// ABOUTME: Tests for RPC utility functions
// ABOUTME: Covers permission logic including safeInternal tools

import { describe, it, expect } from 'vitest';
import { shouldAskPermission, toolKindFromName } from '@lace/agent/rpc/utils';

describe('toolKindFromName', () => {
  it('returns read for file_read', () => {
    expect(toolKindFromName('file_read')).toBe('read');
  });

  it('returns search for file_find and ripgrep_search', () => {
    expect(toolKindFromName('file_find')).toBe('search');
    expect(toolKindFromName('ripgrep_search')).toBe('search');
  });

  it('returns fetch for url_fetch', () => {
    expect(toolKindFromName('url_fetch')).toBe('fetch');
  });

  it('returns execute for bash and delegate', () => {
    expect(toolKindFromName('bash')).toBe('execute');
    expect(toolKindFromName('delegate')).toBe('execute');
  });

  it('returns edit for file_write and file_edit', () => {
    expect(toolKindFromName('file_write')).toBe('edit');
    expect(toolKindFromName('file_edit')).toBe('edit');
  });

  it('returns other for unknown tools', () => {
    expect(toolKindFromName('unknown_tool')).toBe('other');
  });
});

describe('shouldAskPermission', () => {
  describe('basic approval modes', () => {
    it('returns false for dangerouslySkipPermissions mode', () => {
      expect(shouldAskPermission('dangerouslySkipPermissions', 'execute')).toBe(false);
      expect(shouldAskPermission('dangerouslySkipPermissions', 'edit')).toBe(false);
    });

    it('returns false for approve mode', () => {
      expect(shouldAskPermission('approve', 'execute')).toBe(false);
      expect(shouldAskPermission('approve', 'edit')).toBe(false);
    });

    it('returns false for deny mode (handled separately)', () => {
      expect(shouldAskPermission('deny', 'execute')).toBe(false);
    });
  });

  describe('ask mode (default)', () => {
    it('returns false for read and search kinds', () => {
      expect(shouldAskPermission('ask', 'read')).toBe(false);
      expect(shouldAskPermission('ask', 'search')).toBe(false);
    });

    it('returns true for execute, edit, fetch, other kinds', () => {
      expect(shouldAskPermission('ask', 'execute')).toBe(true);
      expect(shouldAskPermission('ask', 'edit')).toBe(true);
      expect(shouldAskPermission('ask', 'fetch')).toBe(true);
      expect(shouldAskPermission('ask', 'other')).toBe(true);
    });
  });

  describe('approveReads mode', () => {
    it('returns false for read and search kinds', () => {
      expect(shouldAskPermission('approveReads', 'read')).toBe(false);
      expect(shouldAskPermission('approveReads', 'search')).toBe(false);
    });

    it('returns true for other kinds', () => {
      expect(shouldAskPermission('approveReads', 'execute')).toBe(true);
      expect(shouldAskPermission('approveReads', 'edit')).toBe(true);
    });
  });

  describe('approveEdits mode', () => {
    it('returns false for read, search, and edit kinds', () => {
      expect(shouldAskPermission('approveEdits', 'read')).toBe(false);
      expect(shouldAskPermission('approveEdits', 'search')).toBe(false);
      expect(shouldAskPermission('approveEdits', 'edit')).toBe(false);
    });

    it('returns true for execute and other kinds', () => {
      expect(shouldAskPermission('approveEdits', 'execute')).toBe(true);
      expect(shouldAskPermission('approveEdits', 'other')).toBe(true);
    });
  });

  describe('safeInternal tools', () => {
    it('returns false for safeInternal tools regardless of approval mode', () => {
      // In ask mode, execute normally requires permission
      expect(shouldAskPermission('ask', 'execute', { safeInternal: true })).toBe(false);
      expect(shouldAskPermission('ask', 'other', { safeInternal: true })).toBe(false);
    });

    it('returns false for safeInternal tools in approveReads mode', () => {
      expect(shouldAskPermission('approveReads', 'execute', { safeInternal: true })).toBe(false);
    });

    it('returns false for safeInternal tools in approveEdits mode', () => {
      expect(shouldAskPermission('approveEdits', 'execute', { safeInternal: true })).toBe(false);
    });

    it('still returns false when safeInternal is false (normal behavior)', () => {
      expect(shouldAskPermission('ask', 'execute', { safeInternal: false })).toBe(true);
    });

    it('still returns false when annotations are undefined (normal behavior)', () => {
      expect(shouldAskPermission('ask', 'execute', undefined)).toBe(true);
    });
  });
});
