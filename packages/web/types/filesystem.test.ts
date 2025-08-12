// ABOUTME: Tests for filesystem type validation schemas
// ABOUTME: Ensures filesystem API types work correctly with various inputs

import { describe, it, expect } from 'vitest';
import {
  ListDirectoryRequestSchema,
  DirectoryEntrySchema,
  ListDirectoryResponseSchema,
  type DirectoryEntry,
  type ListDirectoryResponse,
} from './filesystem';

describe('Filesystem Type Validation', () => {
  describe('ListDirectoryRequestSchema', () => {
    it('should validate valid directory paths', () => {
      const validPaths = ['/home/user', '/home/user/Documents', '/Users/jane/projects'];

      for (const path of validPaths) {
        const result = ListDirectoryRequestSchema.safeParse({ path });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.path).toBe(path);
        }
      }
    });

    it('should reject empty paths', () => {
      const result = ListDirectoryRequestSchema.safeParse({ path: '' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe('Path cannot be empty');
      }
    });

    it('should reject missing path property', () => {
      const result = ListDirectoryRequestSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('DirectoryEntrySchema', () => {
    it('should validate valid directory entries', () => {
      const validEntry: DirectoryEntry = {
        name: 'Documents',
        path: '/home/user/Documents',
        type: 'directory',
        lastModified: new Date('2024-01-15T10:30:00Z'),
        permissions: {
          canRead: true,
          canWrite: true,
        },
      };

      const result = DirectoryEntrySchema.safeParse(validEntry);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Documents');
        expect(result.data.type).toBe('directory');
        expect(result.data.permissions.canRead).toBe(true);
      }
    });

    it('should validate file entries', () => {
      const fileEntry: DirectoryEntry = {
        name: 'readme.txt',
        path: '/home/user/readme.txt',
        type: 'file',
        lastModified: new Date('2024-01-15T10:30:00Z'),
        permissions: {
          canRead: true,
          canWrite: false,
        },
      };

      const result = DirectoryEntrySchema.safeParse(fileEntry);
      expect(result.success).toBe(true);
    });

    it('should reject invalid entry types', () => {
      const invalidEntry = {
        name: 'test',
        path: '/home/test',
        type: 'symlink', // Invalid type
        lastModified: new Date(),
        permissions: { canRead: true, canWrite: false },
      };

      const result = DirectoryEntrySchema.safeParse(invalidEntry);
      expect(result.success).toBe(false);
    });

    it('should reject entries with missing required fields', () => {
      const incompleteEntry = {
        name: 'test',
        type: 'directory',
        // Missing path, lastModified, permissions
      };

      const result = DirectoryEntrySchema.safeParse(incompleteEntry);
      expect(result.success).toBe(false);
    });
  });

  describe('ListDirectoryResponseSchema', () => {
    it('should validate complete directory responses', () => {
      const validResponse: ListDirectoryResponse = {
        currentPath: '/home/user/Documents',
        parentPath: '/home/user',
        breadcrumbPaths: ['/home/user', '/home/user/Documents'],
        breadcrumbNames: ['Home', 'Documents'],
        homeDirectory: '/home/user',
        entries: [
          {
            name: 'Projects',
            path: '/home/user/Documents/Projects',
            type: 'directory',
            lastModified: new Date('2024-01-15T10:30:00Z'),
            permissions: {
              canRead: true,
              canWrite: true,
            },
          },
          {
            name: 'notes.txt',
            path: '/home/user/Documents/notes.txt',
            type: 'file',
            lastModified: new Date('2024-01-14T15:45:00Z'),
            permissions: {
              canRead: true,
              canWrite: false,
            },
          },
        ],
      };

      const result = ListDirectoryResponseSchema.safeParse(validResponse);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.entries).toHaveLength(2);
        expect(result.data.entries[0].type).toBe('directory');
        expect(result.data.entries[1].type).toBe('file');
      }
    });

    it('should validate root directory response with null parent', () => {
      const rootResponse: ListDirectoryResponse = {
        currentPath: '/home/user',
        parentPath: null,
        breadcrumbPaths: ['/home/user'],
        breadcrumbNames: ['Home'],
        homeDirectory: '/home/user',
        entries: [],
      };

      const result = ListDirectoryResponseSchema.safeParse(rootResponse);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.parentPath).toBeNull();
      }
    });

    it('should validate empty directory responses', () => {
      const emptyResponse: ListDirectoryResponse = {
        currentPath: '/home/user/empty',
        parentPath: '/home/user',
        breadcrumbPaths: ['/home/user', '/home/user/empty'],
        breadcrumbNames: ['Home', 'empty'],
        homeDirectory: '/home/user',
        entries: [],
      };

      const result = ListDirectoryResponseSchema.safeParse(emptyResponse);
      expect(result.success).toBe(true);
    });
  });

  describe('Type inference', () => {
    it('should provide correct TypeScript types', () => {
      // This test ensures type inference works correctly at compile time
      const entry: DirectoryEntry = {
        name: 'test',
        path: '/test',
        type: 'directory',
        lastModified: new Date(),
        permissions: {
          canRead: true,
          canWrite: false,
        },
      };

      // These should not cause TypeScript errors
      expect(typeof entry.name).toBe('string');
      expect(typeof entry.permissions.canRead).toBe('boolean');
      expect(typeof entry.permissions.canWrite).toBe('boolean');
    });
  });
});
