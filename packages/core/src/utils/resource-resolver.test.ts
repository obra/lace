// ABOUTME: Tests for unified resource path resolution across development and production modes
// ABOUTME: Validates correct path resolution for bundled resources like data files and templates

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import {
  resolveResourcePath,
  resolveDataDirectory,
  resolveTemplateDirectory,
  isStandaloneMode,
} from '~/utils/resource-resolver';

describe('resource-resolver', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe('resolveResourcePath', () => {
    it('should resolve paths in development mode using import.meta.url', () => {
      process.env.NODE_ENV = 'development';

      const fakeImportMetaUrl = 'file:///project/src/providers/catalog/manager.js';
      const result = resolveResourcePath(fakeImportMetaUrl, 'data');

      expect(result).toBe(path.resolve('/project/src/providers/catalog', 'data'));
    });

    it('should resolve paths in production mode using process.cwd()', () => {
      process.env.NODE_ENV = 'production';

      const fakeImportMetaUrl = 'file:///original/dev/path/src/providers/catalog/manager.js';
      const result = resolveResourcePath(fakeImportMetaUrl, 'data');

      // Should resolve relative to current working directory's src structure
      const expected = path.resolve(process.cwd(), 'src', 'providers', 'catalog', 'data');
      expect(result).toBe(expected);
    });

    it('should handle nested relative paths in development', () => {
      process.env.NODE_ENV = 'development';

      const fakeImportMetaUrl = 'file:///project/src/config/prompt-manager.js';
      const result = resolveResourcePath(fakeImportMetaUrl, '../templates/system.md');

      expect(result).toBe(path.resolve('/project/src/config', '../templates/system.md'));
    });

    it('should handle nested relative paths in production', () => {
      process.env.NODE_ENV = 'production';

      const fakeImportMetaUrl = 'file:///original/path/src/config/subdir/manager.js';
      const result = resolveResourcePath(fakeImportMetaUrl, '../data');

      const expected = path.resolve(process.cwd(), 'src', 'config', 'subdir', '../data');
      expect(result).toBe(expected);
    });

    it('should throw error if import.meta.url is not in src/ directory', () => {
      process.env.NODE_ENV = 'production';

      const fakeImportMetaUrl = 'file:///project/lib/some-module.js';

      expect(() => {
        resolveResourcePath(fakeImportMetaUrl, 'data');
      }).toThrow(
        'Unable to resolve resource path: module file:///project/lib/some-module.js is not in src/ directory'
      );
    });
  });

  describe('convenience functions', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
    });

    it('should resolve data directory correctly', () => {
      const fakeImportMetaUrl = 'file:///project/src/providers/catalog/manager.js';
      const result = resolveDataDirectory(fakeImportMetaUrl);

      expect(result).toBe(path.resolve('/project/src/providers/catalog', 'data'));
    });

    it('should resolve template directory correctly', () => {
      const fakeImportMetaUrl = 'file:///project/src/config/prompt-manager.js';
      const result = resolveTemplateDirectory(fakeImportMetaUrl);

      expect(result).toBe(path.resolve('/project/src/config', 'templates'));
    });
  });

  describe('isStandaloneMode', () => {
    it('should return false in development', () => {
      process.env.NODE_ENV = 'development';
      expect(isStandaloneMode()).toBe(false);
    });

    it('should return true in production', () => {
      process.env.NODE_ENV = 'production';
      expect(isStandaloneMode()).toBe(true);
    });

    it('should return false when NODE_ENV is not set', () => {
      delete process.env.NODE_ENV;
      expect(isStandaloneMode()).toBe(false);
    });
  });
});
