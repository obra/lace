// ABOUTME: Tests for session file operation types
// ABOUTME: Validates TypeScript interfaces and Zod schemas for session-scoped file operations

import { describe, it, expect } from 'vitest';
import {
  SessionFileEntrySchema,
  SessionDirectoryResponseSchema,
  SessionFileContentResponseSchema,
  ListSessionDirectoryRequestSchema,
  GetSessionFileRequestSchema,
} from '@/types/session-files';

describe('Session File Types', () => {
  describe('SessionFileEntry validation', () => {
    it('should validate valid file entry', () => {
      const validEntry = {
        name: 'test.ts',
        path: 'src/test.ts',
        type: 'file' as const,
        size: 1024,
        lastModified: new Date(),
        isReadable: true,
      };

      const result = SessionFileEntrySchema.safeParse(validEntry);
      expect(result.success).toBe(true);
    });

    it('should validate valid directory entry', () => {
      const validEntry = {
        name: 'components',
        path: 'src/components',
        type: 'directory' as const,
        lastModified: new Date(),
        isReadable: true,
      };

      const result = SessionFileEntrySchema.safeParse(validEntry);
      expect(result.success).toBe(true);
    });

    it('should reject invalid file types', () => {
      const invalidEntry = {
        name: 'test.ts',
        path: 'src/test.ts',
        type: 'invalid',
        lastModified: new Date(),
        isReadable: true,
      };

      const result = SessionFileEntrySchema.safeParse(invalidEntry);
      expect(result.success).toBe(false);
    });

    it('should require lastModified as Date', () => {
      const invalidEntry = {
        name: 'test.ts',
        path: 'src/test.ts',
        type: 'file' as const,
        lastModified: 'invalid-date',
        isReadable: true,
      };

      const result = SessionFileEntrySchema.safeParse(invalidEntry);
      expect(result.success).toBe(false);
    });
  });

  describe('SessionDirectoryResponse validation', () => {
    it('should validate valid directory response', () => {
      const validResponse = {
        workingDirectory: 'project', // Use basename only for security
        currentPath: 'src',
        entries: [
          {
            name: 'test.ts',
            path: 'src/test.ts',
            type: 'file' as const,
            size: 1024,
            lastModified: new Date(),
            isReadable: true,
          },
        ],
      };

      const result = SessionDirectoryResponseSchema.safeParse(validResponse);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.workingDirectory).toBe('project');
        expect(result.data.entries).toHaveLength(1);
        expect(result.data.entries[0].type).toBe('file');
        expect(result.data.entries[0].size).toBe(1024);
        expect(result.data.entries[0].lastModified).toBeInstanceOf(Date);
      }
    });
  });

  describe('SessionFileContentResponse validation', () => {
    it('should validate valid file content response', () => {
      const validResponse = {
        path: 'src/test.ts',
        content: 'console.log("hello");',
        mimeType: 'text/typescript',
        encoding: 'utf8' as const,
        size: 20,
      };

      const result = SessionFileContentResponseSchema.safeParse(validResponse);
      expect(result.success).toBe(true);
    });


    it('should reject invalid encoding', () => {
      const invalidResponse = {
        path: 'src/test.ts',
        content: 'console.log("hello");',
        mimeType: 'text/typescript',
        encoding: 'base64',
        size: 20,
      };

      const result = SessionFileContentResponseSchema.safeParse(invalidResponse);
      expect(result.success).toBe(false);
    });
  });

  describe('Request schema validation', () => {
    it('should validate directory listing request with path', () => {
      const validRequest = { path: 'src/components' };
      const result = ListSessionDirectoryRequestSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
      expect(result.data?.path).toBe('src/components');
    });

    it('should validate directory listing request without path (default)', () => {
      const validRequest = {};
      const result = ListSessionDirectoryRequestSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
      expect(result.data?.path).toBe('');
    });

    it('should validate file content request', () => {
      const validRequest = { path: 'src/test.ts' };
      const result = GetSessionFileRequestSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    it('should reject empty file path in file request', () => {
      const invalidRequest = { path: '' };
      const result = GetSessionFileRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });
  });
});
