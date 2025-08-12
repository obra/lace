// ABOUTME: Type definitions for filesystem operations
// ABOUTME: Defines interfaces for directory browsing and file system navigation

import { z } from 'zod';

export interface DirectoryEntry {
  name: string;
  path: string;
  type: 'directory' | 'file';
  lastModified: Date;
  permissions: {
    canRead: boolean;
    canWrite: boolean;
  };
}

export interface ListDirectoryResponse {
  currentPath: string;
  parentPath: string | null;
  entries: DirectoryEntry[];
}

// Zod validation schemas
export const ListDirectoryRequestSchema = z.object({
  path: z.string().min(1, 'Path cannot be empty'),
});

export const DirectoryEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.enum(['directory', 'file']),
  lastModified: z.date(),
  permissions: z.object({
    canRead: z.boolean(),
    canWrite: z.boolean(),
  }),
});

export const ListDirectoryResponseSchema = z.object({
  currentPath: z.string(),
  parentPath: z.string().nullable(),
  entries: z.array(DirectoryEntrySchema),
});

// Type inference for request/response validation
export type ListDirectoryRequest = z.infer<typeof ListDirectoryRequestSchema>;
export type ValidatedDirectoryEntry = z.infer<typeof DirectoryEntrySchema>;
export type ValidatedListDirectoryResponse = z.infer<typeof ListDirectoryResponseSchema>;
