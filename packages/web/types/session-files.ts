// ABOUTME: Type definitions for session-scoped file operations
// ABOUTME: Defines interfaces and schemas for secure file browsing within session working directory

import { z } from 'zod';

export interface SessionFileEntry {
  name: string;
  path: string; // Relative to session working directory
  type: 'file' | 'directory';
  size?: number;
  lastModified: Date;
  isReadable: boolean;
}

export interface SessionDirectoryResponse {
  workingDirectory: string;
  currentPath: string; // Relative to working directory
  entries: SessionFileEntry[];
}

export interface SessionFileContentResponse {
  path: string;
  content: string;
  mimeType: string;
  encoding: 'utf8' | 'binary';
  size: number;
}

// Zod schemas for validation
export const SessionFileEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.enum(['file', 'directory']),
  size: z.number().optional(),
  lastModified: z.date(),
  isReadable: z.boolean(),
});

export const SessionDirectoryResponseSchema = z.object({
  workingDirectory: z.string(),
  currentPath: z.string(),
  entries: z.array(SessionFileEntrySchema),
});

export const SessionFileContentResponseSchema = z.object({
  path: z.string(),
  content: z.string(),
  mimeType: z.string(),
  encoding: z.enum(['utf8', 'binary']),
  size: z.number(),
});

// Request schemas
export const ListSessionDirectoryRequestSchema = z.object({
  path: z.string().optional().default(''), // Path relative to working directory
});

export const GetSessionFileRequestSchema = z.object({
  path: z.string().min(1, 'File path is required'),
});
