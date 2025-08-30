// ABOUTME: Type definitions for session-scoped file operations
// ABOUTME: Defines interfaces and schemas for secure file browsing within session working directory

import { z } from 'zod';

// Zod schemas are the source of truth for types

// Zod schemas for validation
export const SessionFileEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.enum(['file', 'directory']),
  size: z.number().optional(),
  lastModified: z.coerce.date(),
  isReadable: z.boolean(),
});

export const SessionDirectoryResponseSchema = z.object({
  workingDirectory: z.string(), // Should be basename only for security
  currentPath: z.string(),
  entries: z.array(SessionFileEntrySchema),
});

export const SessionFileContentResponseSchema = z.object({
  path: z.string(),
  content: z.string(),
  mimeType: z.string(),
  encoding: z.literal('utf8'), // Only support text files
  size: z.number(),
});

// Derive TypeScript types from schemas
export type SessionFileEntry = z.infer<typeof SessionFileEntrySchema>;
export type SessionDirectoryResponse = z.infer<typeof SessionDirectoryResponseSchema>;
export type SessionFileContentResponse = z.infer<typeof SessionFileContentResponseSchema>;

// Request schemas with path traversal protection
export const ListSessionDirectoryRequestSchema = z.object({
  path: z
    .string()
    .optional()
    .default('')
    .refine((path) => !path.includes('..') && !path.includes('\\') && !path.startsWith('/'), {
      message: 'Path contains invalid characters or traversal attempts',
    }), // Path relative to working directory
});

export const GetSessionFileRequestSchema = z.object({
  path: z
    .string()
    .min(1, 'File path is required')
    .refine((path) => !path.includes('..') && !path.includes('\\') && !path.startsWith('/'), {
      message: 'Path contains invalid characters or traversal attempts',
    }),
});
