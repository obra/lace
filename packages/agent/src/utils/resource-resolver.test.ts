// ABOUTME: Tests for unified resource path resolution across development and production modes
// ABOUTME: Validates correct path resolution for bundled resources like data files and templates

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import {
  resolveResourcePath,
  resolveDataDirectory,
  resolveTemplateDirectory,
  isStandaloneMode,
} from './resource-resolver';

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
        'Unable to resolve resource path: module file:///project/lib/some-module.js is not in src/ or packages/agent/src/ directory'
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

  describe('built dist contains agent-personas at the resolver-expected location', () => {
    // These tests run after `pretest` rebuilds the package, so the dist tree must reflect
    // the current build script. They guard against missing persona dir → WARN
    // AND against a `cp -r` rebuild bug that would nest dist/config/agent-personas/agent-personas/.
    const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const distPersonas = path.resolve(packageRoot, 'dist/config/agent-personas');

    it('places top-level persona markdown files directly under dist/config/agent-personas', () => {
      expect(fs.existsSync(path.join(distPersonas, 'lace.md'))).toBe(true);
      expect(fs.existsSync(path.join(distPersonas, 'coding-agent.md'))).toBe(true);
    });

    it('does not nest a duplicate agent-personas/ subdirectory after rebuild', () => {
      // BSD `cp -r src existing-dir` copies src INTO existing-dir, producing
      // dist/config/agent-personas/agent-personas/ on the second build. That stale tree
      // would diverge from source on edits, so the build must be idempotent.
      expect(fs.existsSync(path.join(distPersonas, 'agent-personas'))).toBe(false);
    });

    it('matches the resolver candidate path used in NODE_ENV=production', () => {
      // Simulates persona-registry calling resolveResourcePath from a dist/ module.
      const distModuleUrl = `file://${path.join(packageRoot, 'dist/config/persona-registry.js')}`;
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const resolved = resolveResourcePath(distModuleUrl, 'agent-personas');
        expect(resolved).toBe(distPersonas);
        expect(fs.existsSync(resolved)).toBe(true);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });
});
