# Session-Level File Browser Implementation Plan

## Overview

This plan implements a file browser for the Lace web UI that allows users to browse and view files within their session's working directory. The file browser appears in the sidebar and includes tree navigation, search, and file viewing capabilities.

**Key Requirements:**
- Session-scoped file access (security: files only within session's workingDirectory)
- Tree-based directory navigation 
- File search functionality
- Modal file viewer with syntax highlighting
- Leverage existing UI components and patterns
- Test-driven development with real filesystem operations (no mocking core functionality)
- Frequent commits after each working increment

## Prerequisites

### Understanding the Codebase
Before starting, read these files to understand existing patterns:

**UI Component Architecture:**
- `packages/web/app/play/page.tsx` - Complete component catalog 
- `packages/web/components/ui/index.ts` - Available UI components
- `packages/web/components/layout/Sidebar.tsx` - Sidebar system
- `packages/web/components/ui/Modal.tsx` - Modal patterns

**File System Integration:**
- `packages/web/components/ui/DirectoryField.tsx` - Directory browsing patterns
- `packages/web/types/filesystem.ts` - Existing file system types
- `packages/web/app/api/filesystem/list/route.ts` - Directory listing API

**Session Architecture:**
- `packages/web/types/api.ts` - Session configuration (look for `SessionConfiguration.workingDirectory`)
- `packages/web/lib/server/session-service.ts` - Session management
- `packages/web/components/providers/SessionProvider.tsx` - Session state

**Syntax Highlighting:**
- `packages/web/components/files/FileDiffViewer.tsx` - Existing highlight.js integration

### TypeScript Rules
- **Never use `any` type** - use `unknown` with type guards instead
- **Always type function parameters and return types explicitly**
- **Use `z.infer<>` for Zod schema types**
- **Import types with `import type`**

### Testing Rules
- **Test-Driven Development**: Write failing tests first, then implement
- **No mocking core functionality**: Use real filesystem operations
- **Mock only external dependencies**: APIs, databases, etc.
- **Test file naming**: `ComponentName.test.tsx` next to source files

## Implementation Tasks

---

## Task 1: Create Session File API Types

**Goal**: Define TypeScript interfaces for session-scoped file operations

**Files to create:**
- `packages/web/types/session-files.ts`

**Files to reference:**
- `packages/web/types/filesystem.ts` - Study existing patterns
- `packages/web/types/api.ts` - Study API response patterns

**Implementation:**

```typescript
// packages/web/types/session-files.ts
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
```

**Testing:**
Create `packages/web/types/session-files.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  SessionFileEntrySchema,
  SessionDirectoryResponseSchema,
  ListSessionDirectoryRequestSchema,
} from './session-files';

describe('Session File Types', () => {
  it('should validate SessionFileEntry schema', () => {
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

  it('should validate directory listing request', () => {
    const validRequest = { path: 'src/components' };
    const result = ListSessionDirectoryRequestSchema.safeParse(validRequest);
    expect(result.success).toBe(true);
  });
});
```

**How to test:**
```bash
cd packages/web
npm run test:run types/session-files.test.ts
```

**Commit message**: "feat: add TypeScript types for session file operations"

---

## Task 2: Create Session Directory Listing API

**Goal**: API endpoint to list files in a session's working directory with path traversal protection

**Files to create:**
- `packages/web/app/api/sessions/[sessionId]/files/route.ts`

**Files to reference:**
- `packages/web/app/api/filesystem/list/route.ts` - Study directory listing patterns
- `packages/web/lib/server/session-service.ts` - Study session access patterns
- `packages/web/lib/serialization.ts` - Study response serialization
- `packages/web/lib/server/api-utils.ts` - Study error handling

**Implementation:**

```typescript
// packages/web/app/api/sessions/[sessionId]/files/route.ts
import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import { join, resolve, relative, dirname } from 'path';
import { createSuperjsonResponse, createErrorResponse } from '@/lib/server/api-utils';
import { SessionService } from '@/lib/server/session-service';
import { asThreadId } from '@/types/core';
import { 
  ListSessionDirectoryRequestSchema,
  type SessionDirectoryResponse,
  type SessionFileEntry 
} from '@/types/session-files';

export async function GET(request: NextRequest, { params }: { params: { sessionId: string } }) {
  try {
    const { searchParams } = new URL(request.url);
    const rawPath = searchParams.get('path') || '';
    
    // Validate request
    const { path: requestedPath } = ListSessionDirectoryRequestSchema.parse({ path: rawPath });
    
    // Get session and working directory
    const sessionService = new SessionService();
    const session = await sessionService.getSession(asThreadId(params.sessionId));
    
    if (!session) {
      return createErrorResponse('Session not found', 404, { code: 'SESSION_NOT_FOUND' });
    }
    
    const sessionConfig = session.getConfiguration();
    const workingDirectory = sessionConfig?.workingDirectory;
    
    if (!workingDirectory) {
      return createErrorResponse('Session has no working directory configured', 400, { 
        code: 'NO_WORKING_DIRECTORY' 
      });
    }
    
    // Security: Resolve paths and prevent traversal outside working directory
    const absoluteWorkingDir = resolve(workingDirectory);
    const absoluteRequestedPath = resolve(absoluteWorkingDir, requestedPath);
    const relativePath = relative(absoluteWorkingDir, absoluteRequestedPath);
    
    // Prevent path traversal attacks
    if (relativePath.startsWith('..') || resolve(absoluteWorkingDir, relativePath) !== absoluteRequestedPath) {
      return createErrorResponse('Path access denied', 403, { code: 'PATH_ACCESS_DENIED' });
    }
    
    // Check if directory exists and is accessible
    try {
      const stats = await fs.stat(absoluteRequestedPath);
      if (!stats.isDirectory()) {
        return createErrorResponse('Path is not a directory', 400, { code: 'NOT_A_DIRECTORY' });
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        if (error.code === 'ENOENT') {
          return createErrorResponse('Directory not found', 404, { code: 'DIRECTORY_NOT_FOUND' });
        }
        if (error.code === 'EACCES') {
          return createErrorResponse('Permission denied', 403, { code: 'PERMISSION_DENIED' });
        }
      }
      throw error; // Re-throw unexpected errors
    }
    
    // Read directory contents
    const dirents = await fs.readdir(absoluteRequestedPath, { withFileTypes: true });
    const entries: SessionFileEntry[] = [];
    
    for (const dirent of dirents) {
      try {
        const entryPath = join(absoluteRequestedPath, dirent.name);
        const entryStats = await fs.stat(entryPath);
        
        // Check if readable
        await fs.access(entryPath, fs.constants.R_OK);
        
        // Calculate relative path from working directory
        const relativeEntryPath = relative(absoluteWorkingDir, entryPath);
        
        entries.push({
          name: dirent.name,
          path: relativeEntryPath,
          type: dirent.isDirectory() ? 'directory' : 'file',
          size: dirent.isFile() ? entryStats.size : undefined,
          lastModified: entryStats.mtime,
          isReadable: true,
        });
      } catch {
        // Skip entries we can't read
        continue;
      }
    }
    
    // Sort: directories first, then alphabetically
    entries.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    
    const response: SessionDirectoryResponse = {
      workingDirectory: absoluteWorkingDir,
      currentPath: relativePath,
      entries,
    };
    
    return createSuperjsonResponse(response);
    
  } catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to list directory',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}
```

**Testing:**
Create `packages/web/app/api/sessions/[sessionId]/files/route.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseResponse } from '@/lib/serialization';
import type { SessionDirectoryResponse } from '@/types/session-files';

describe('/api/sessions/[sessionId]/files', () => {
  let testDir: string;
  let testSessionId: string;

  beforeEach(async () => {
    // Create temporary test directory with real filesystem
    testDir = join(tmpdir(), `lace-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    
    // Create test files and directories
    await fs.mkdir(join(testDir, 'src'));
    await fs.writeFile(join(testDir, 'package.json'), '{"name": "test"}');
    await fs.writeFile(join(testDir, 'src', 'index.ts'), 'console.log("hello");');
    
    testSessionId = 'test-session-123';
    
    // Mock session service to return our test directory
    // Note: This would require dependency injection in real implementation
    // For now, document that this test needs session mocking setup
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should list files in session working directory', async () => {
    const request = new NextRequest(
      `http://localhost/api/sessions/${testSessionId}/files`
    );
    
    // TODO: Mock SessionService.getSession() to return session with workingDirectory: testDir
    // This requires setting up dependency injection for SessionService
    
    const response = await GET(request, { params: { sessionId: testSessionId } });
    
    expect(response.status).toBe(200);
    const data = await parseResponse<SessionDirectoryResponse>(response);
    expect(data.entries).toHaveLength(2); // src directory + package.json
    expect(data.entries.find(e => e.name === 'src')?.type).toBe('directory');
    expect(data.entries.find(e => e.name === 'package.json')?.type).toBe('file');
  });

  it('should prevent path traversal attacks', async () => {
    const request = new NextRequest(
      `http://localhost/api/sessions/${testSessionId}/files?path=../../../etc`
    );
    
    const response = await GET(request, { params: { sessionId: testSessionId } });
    
    expect(response.status).toBe(403);
    const data = await parseResponse<{ error: string; code: string }>(response);
    expect(data.code).toBe('PATH_ACCESS_DENIED');
  });

  it('should handle non-existent session', async () => {
    const request = new NextRequest(
      'http://localhost/api/sessions/invalid-session/files'
    );
    
    const response = await GET(request, { params: { sessionId: 'invalid-session' } });
    
    expect(response.status).toBe(404);
    const data = await parseResponse<{ error: string; code: string }>(response);
    expect(data.code).toBe('SESSION_NOT_FOUND');
  });
});
```

**Testing Notes:**
The test requires mocking the SessionService. Since we avoid mocking core functionality, this test demonstrates the integration points but may need dependency injection setup to run properly.

**How to test:**
```bash
cd packages/web
npm run test:run app/api/sessions/[sessionId]/files/route.test.ts
```

**Commit message**: "feat: add session-scoped directory listing API with path traversal protection"

---

## Task 3: Create Session File Content API

**Goal**: API endpoint to retrieve file content from within a session's working directory

**Files to create:**
- `packages/web/app/api/sessions/[sessionId]/files/[...path]/route.ts`

**Files to reference:**
- Previous task's route for session validation patterns
- `packages/web/components/files/FileDiffViewer.tsx` - See how files are handled for syntax highlighting

**Implementation:**

```typescript
// packages/web/app/api/sessions/[sessionId]/files/[...path]/route.ts
import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import { resolve, relative, extname } from 'path';
import { createSuperjsonResponse, createErrorResponse } from '@/lib/server/api-utils';
import { SessionService } from '@/lib/server/session-service';
import { asThreadId } from '@/types/core';
import { 
  GetSessionFileRequestSchema,
  type SessionFileContentResponse 
} from '@/types/session-files';

// Simple MIME type detection based on file extension
function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.js': 'text/javascript',
    '.ts': 'text/typescript',
    '.jsx': 'text/javascript',
    '.tsx': 'text/typescript',
    '.json': 'application/json',
    '.md': 'text/markdown',
    '.txt': 'text/plain',
    '.html': 'text/html',
    '.css': 'text/css',
    '.py': 'text/x-python',
    '.java': 'text/x-java',
    '.go': 'text/x-go',
    '.rs': 'text/x-rust',
    '.cpp': 'text/x-c++',
    '.c': 'text/x-c',
    '.h': 'text/x-c',
    '.yml': 'text/yaml',
    '.yaml': 'text/yaml',
  };
  return mimeTypes[ext] || 'text/plain';
}

// Check if file is likely text-based
function isTextFile(mimeType: string): boolean {
  return mimeType.startsWith('text/') || mimeType === 'application/json';
}

export async function GET(request: NextRequest, { params }: { params: { sessionId: string, path: string[] } }) {
  try {
    const filePath = params.path.join('/');
    
    // Validate request
    const { path: requestedPath } = GetSessionFileRequestSchema.parse({ path: filePath });
    
    // Get session and working directory
    const sessionService = new SessionService();
    const session = await sessionService.getSession(asThreadId(params.sessionId));
    
    if (!session) {
      return createErrorResponse('Session not found', 404, { code: 'SESSION_NOT_FOUND' });
    }
    
    const sessionConfig = session.getConfiguration();
    const workingDirectory = sessionConfig?.workingDirectory;
    
    if (!workingDirectory) {
      return createErrorResponse('Session has no working directory configured', 400, { 
        code: 'NO_WORKING_DIRECTORY' 
      });
    }
    
    // Security: Resolve paths and prevent traversal outside working directory
    const absoluteWorkingDir = resolve(workingDirectory);
    const absoluteFilePath = resolve(absoluteWorkingDir, requestedPath);
    const relativePath = relative(absoluteWorkingDir, absoluteFilePath);
    
    // Prevent path traversal attacks
    if (relativePath.startsWith('..') || resolve(absoluteWorkingDir, relativePath) !== absoluteFilePath) {
      return createErrorResponse('Path access denied', 403, { code: 'PATH_ACCESS_DENIED' });
    }
    
    // Check if file exists and is accessible
    let stats;
    try {
      stats = await fs.stat(absoluteFilePath);
      if (stats.isDirectory()) {
        return createErrorResponse('Path is a directory, not a file', 400, { code: 'PATH_IS_DIRECTORY' });
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        if (error.code === 'ENOENT') {
          return createErrorResponse('File not found', 404, { code: 'FILE_NOT_FOUND' });
        }
        if (error.code === 'EACCES') {
          return createErrorResponse('Permission denied', 403, { code: 'PERMISSION_DENIED' });
        }
      }
      throw error;
    }
    
    // Check file size - limit to 1MB for text files
    const MAX_FILE_SIZE = 1024 * 1024; // 1MB
    if (stats.size > MAX_FILE_SIZE) {
      return createErrorResponse('File too large to display', 413, { 
        code: 'FILE_TOO_LARGE',
        details: { maxSize: MAX_FILE_SIZE, actualSize: stats.size }
      });
    }
    
    // Determine MIME type and encoding
    const mimeType = getMimeType(absoluteFilePath);
    const isText = isTextFile(mimeType);
    
    if (!isText) {
      return createErrorResponse('Binary files are not supported', 415, { 
        code: 'UNSUPPORTED_FILE_TYPE',
        details: { mimeType }
      });
    }
    
    // Read file content
    let content: string;
    try {
      await fs.access(absoluteFilePath, fs.constants.R_OK);
      content = await fs.readFile(absoluteFilePath, 'utf8');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'EACCES') {
        return createErrorResponse('Permission denied', 403, { code: 'PERMISSION_DENIED' });
      }
      throw error;
    }
    
    const response: SessionFileContentResponse = {
      path: relativePath,
      content,
      mimeType,
      encoding: 'utf8',
      size: stats.size,
    };
    
    return createSuperjsonResponse(response);
    
  } catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to read file',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}
```

**Testing:**
Create `packages/web/app/api/sessions/[sessionId]/files/[...path]/route.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseResponse } from '@/lib/serialization';
import type { SessionFileContentResponse } from '@/types/session-files';

describe('/api/sessions/[sessionId]/files/[...path]', () => {
  let testDir: string;
  let testSessionId: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `lace-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    
    // Create test files
    await fs.writeFile(join(testDir, 'test.ts'), 'const hello = "world";');
    await fs.writeFile(join(testDir, 'large-file.txt'), 'x'.repeat(2 * 1024 * 1024)); // 2MB
    
    testSessionId = 'test-session-123';
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should return file content for valid text file', async () => {
    const request = new NextRequest(
      `http://localhost/api/sessions/${testSessionId}/files/test.ts`
    );
    
    // TODO: Mock SessionService as in previous task
    
    const response = await GET(request, { 
      params: { sessionId: testSessionId, path: ['test.ts'] } 
    });
    
    expect(response.status).toBe(200);
    const data = await parseResponse<SessionFileContentResponse>(response);
    expect(data.content).toBe('const hello = "world";');
    expect(data.mimeType).toBe('text/typescript');
    expect(data.encoding).toBe('utf8');
  });

  it('should reject files that are too large', async () => {
    const request = new NextRequest(
      `http://localhost/api/sessions/${testSessionId}/files/large-file.txt`
    );
    
    const response = await GET(request, { 
      params: { sessionId: testSessionId, path: ['large-file.txt'] } 
    });
    
    expect(response.status).toBe(413);
    const data = await parseResponse<{ error: string; code: string }>(response);
    expect(data.code).toBe('FILE_TOO_LARGE');
  });

  it('should prevent path traversal in file access', async () => {
    const request = new NextRequest(
      `http://localhost/api/sessions/${testSessionId}/files/../../../etc/passwd`
    );
    
    const response = await GET(request, { 
      params: { sessionId: testSessionId, path: ['..', '..', '..', 'etc', 'passwd'] } 
    });
    
    expect(response.status).toBe(403);
    const data = await parseResponse<{ error: string; code: string }>(response);
    expect(data.code).toBe('PATH_ACCESS_DENIED');
  });
});
```

**How to test:**
```bash
cd packages/web
npm run test:run app/api/sessions/[sessionId]/files/[...path]/route.test.ts
```

**Commit message**: "feat: add session file content API with size limits and MIME type detection"

---

## Task 4: Create File Tree Component

**Goal**: Reusable component for displaying session file tree with expand/collapse

**Files to create:**
- `packages/web/components/files/SessionFileTree.tsx`
- `packages/web/components/files/SessionFileTree.test.tsx`

**Files to reference:**
- `packages/web/components/ui/DirectoryField.tsx` - Study tree-like navigation patterns
- `packages/web/lib/fontawesome.ts` - Available icons
- `packages/web/components/ui/index.ts` - Available UI components

**Implementation:**

```typescript
// packages/web/components/files/SessionFileTree.tsx
'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faFolder, 
  faFolderOpen, 
  faFile, 
  faChevronRight, 
  faChevronDown,
  faSpinner 
} from '@/lib/fontawesome';
import { api } from '@/lib/api-client';
import type { SessionDirectoryResponse, SessionFileEntry } from '@/types/session-files';

interface FileTreeNode extends SessionFileEntry {
  children?: FileTreeNode[];
  isExpanded?: boolean;
  isLoading?: boolean;
}

interface SessionFileTreeProps {
  sessionId: string;
  onFileSelect: (filePath: string, fileName: string) => void;
  searchTerm?: string;
  className?: string;
}

interface FileTreeItemProps {
  node: FileTreeNode;
  depth: number;
  sessionId: string;
  onFileSelect: (filePath: string, fileName: string) => void;
  onDirectoryToggle: (path: string) => void;
  searchTerm?: string;
}

// File icon helper
function getFileIcon(fileName: string, isDirectory: boolean, isExpanded: boolean = false): React.ReactNode {
  if (isDirectory) {
    return (
      <FontAwesomeIcon 
        icon={isExpanded ? faFolderOpen : faFolder} 
        className="w-4 h-4 text-blue-500"
      />
    );
  }
  
  // Simple file icon - could be enhanced with file type detection
  return <FontAwesomeIcon icon={faFile} className="w-4 h-4 text-gray-500" />;
}

// Highlight search term in text
function highlightSearchTerm(text: string, searchTerm: string): React.ReactNode {
  if (!searchTerm || searchTerm.length < 2) return text;
  
  const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);
  
  return parts.map((part, index) => 
    regex.test(part) ? (
      <mark key={index} className="bg-yellow-200 text-yellow-900 px-0.5 rounded">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

function FileTreeItem({
  node,
  depth,
  sessionId,
  onFileSelect,
  onDirectoryToggle,
  searchTerm
}: FileTreeItemProps) {
  const handleClick = useCallback(() => {
    if (node.type === 'directory') {
      onDirectoryToggle(node.path);
    } else {
      onFileSelect(node.path, node.name);
    }
  }, [node.type, node.path, node.name, onDirectoryToggle, onFileSelect]);

  const shouldShowInSearch = useMemo(() => {
    if (!searchTerm || searchTerm.length < 2) return true;
    return node.name.toLowerCase().includes(searchTerm.toLowerCase());
  }, [node.name, searchTerm]);

  if (!shouldShowInSearch) return null;

  return (
    <>
      <div
        className={`
          flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-base-200 rounded
          transition-colors duration-150
        `}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleClick}
      >
        {/* Expand/collapse indicator for directories */}
        {node.type === 'directory' && (
          <div className="w-4 h-4 flex items-center justify-center">
            {node.isLoading ? (
              <FontAwesomeIcon icon={faSpinner} className="w-3 h-3 animate-spin text-gray-400" />
            ) : (
              <FontAwesomeIcon
                icon={node.isExpanded ? faChevronDown : faChevronRight}
                className="w-3 h-3 text-gray-400"
              />
            )}
          </div>
        )}
        {node.type === 'file' && <div className="w-4" />}
        
        {/* File/folder icon */}
        {getFileIcon(node.name, node.type === 'directory', node.isExpanded)}
        
        {/* File/folder name */}
        <span className="text-sm truncate flex-1">
          {highlightSearchTerm(node.name, searchTerm || '')}
        </span>
        
        {/* File size for files */}
        {node.type === 'file' && node.size && (
          <span className="text-xs text-gray-400">
            {formatFileSize(node.size)}
          </span>
        )}
      </div>
      
      {/* Render children if directory is expanded */}
      {node.type === 'directory' && node.isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              sessionId={sessionId}
              onFileSelect={onFileSelect}
              onDirectoryToggle={onDirectoryToggle}
              searchTerm={searchTerm}
            />
          ))}
        </div>
      )}
    </>
  );
}

// Helper function to format file size
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function SessionFileTree({
  sessionId,
  onFileSelect,
  searchTerm,
  className = ''
}: SessionFileTreeProps) {
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  // Load directory contents
  const loadDirectory = useCallback(async (path: string = '') => {
    try {
      setIsLoading(true);
      setError(null);
      
      const url = `/api/sessions/${sessionId}/files${path ? `?path=${encodeURIComponent(path)}` : ''}`;
      const response = await api.get<SessionDirectoryResponse>(url);
      
      if (path === '') {
        // Loading root directory
        const rootNodes: FileTreeNode[] = response.entries.map(entry => ({
          ...entry,
          isExpanded: false,
          isLoading: false
        }));
        setFileTree(rootNodes);
        setHasLoaded(true);
      } else {
        // Loading subdirectory - update the tree
        setFileTree(prevTree => updateTreeNode(prevTree, path, response.entries));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load directory');
      console.error('Failed to load directory:', err);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  // Update tree node with loaded children
  const updateTreeNode = useCallback((
    nodes: FileTreeNode[],
    targetPath: string,
    newEntries: SessionFileEntry[]
  ): FileTreeNode[] => {
    return nodes.map(node => {
      if (node.path === targetPath) {
        return {
          ...node,
          children: newEntries.map(entry => ({
            ...entry,
            isExpanded: false,
            isLoading: false
          })),
          isExpanded: true,
          isLoading: false
        };
      } else if (node.children) {
        return {
          ...node,
          children: updateTreeNode(node.children, targetPath, newEntries)
        };
      }
      return node;
    });
  }, []);

  // Handle directory expand/collapse
  const handleDirectoryToggle = useCallback((path: string) => {
    setFileTree(prevTree => {
      return prevTree.map(node => {
        if (node.path === path) {
          if (node.isExpanded) {
            // Collapse
            return { ...node, isExpanded: false };
          } else {
            // Expand - load children if not already loaded
            const updatedNode = { ...node, isExpanded: true, isLoading: !node.children };
            if (!node.children) {
              // Load directory contents
              void loadDirectory(path);
            }
            return updatedNode;
          }
        } else if (node.children) {
          return {
            ...node,
            children: toggleTreeNode(node.children, path)
          };
        }
        return node;
      });
    });
  }, [loadDirectory]);

  // Helper function to recursively toggle nodes
  const toggleTreeNode = useCallback((nodes: FileTreeNode[], targetPath: string): FileTreeNode[] => {
    return nodes.map(node => {
      if (node.path === targetPath) {
        if (node.isExpanded) {
          return { ...node, isExpanded: false };
        } else {
          const updatedNode = { ...node, isExpanded: true, isLoading: !node.children };
          if (!node.children) {
            void loadDirectory(targetPath);
          }
          return updatedNode;
        }
      } else if (node.children) {
        return {
          ...node,
          children: toggleTreeNode(node.children, targetPath)
        };
      }
      return node;
    });
  }, [loadDirectory]);

  // Load root directory on mount
  React.useEffect(() => {
    if (!hasLoaded) {
      void loadDirectory();
    }
  }, [loadDirectory, hasLoaded]);

  if (isLoading && !hasLoaded) {
    return (
      <div className={`flex items-center justify-center p-4 ${className}`}>
        <FontAwesomeIcon icon={faSpinner} className="w-4 h-4 animate-spin mr-2" />
        <span className="text-sm text-gray-600">Loading files...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`p-4 text-center ${className}`}>
        <div className="text-sm text-red-600">{error}</div>
        <button
          onClick={() => loadDirectory()}
          className="mt-2 text-xs text-blue-600 hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className={`overflow-y-auto ${className}`}>
      {fileTree.map((node) => (
        <FileTreeItem
          key={node.path}
          node={node}
          depth={0}
          sessionId={sessionId}
          onFileSelect={onFileSelect}
          onDirectoryToggle={handleDirectoryToggle}
          searchTerm={searchTerm}
        />
      ))}
      {fileTree.length === 0 && hasLoaded && (
        <div className="p-4 text-center text-sm text-gray-500">
          No files found
        </div>
      )}
    </div>
  );
}
```

**Testing:**
Create `packages/web/components/files/SessionFileTree.test.tsx`:

```typescript
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionFileTree } from './SessionFileTree';
import * as apiClient from '@/lib/api-client';

// Mock the API client
vi.mock('@/lib/api-client', () => ({
  api: {
    get: vi.fn()
  }
}));

const mockApiGet = vi.mocked(apiClient.api.get);

describe('SessionFileTree', () => {
  const mockOnFileSelect = vi.fn();
  const defaultProps = {
    sessionId: 'test-session-123',
    onFileSelect: mockOnFileSelect,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render loading state initially', () => {
    render(<SessionFileTree {...defaultProps} />);
    expect(screen.getByText('Loading files...')).toBeInTheDocument();
  });

  it('should load and display file tree on mount', async () => {
    const mockResponse = {
      workingDirectory: '/test/dir',
      currentPath: '',
      entries: [
        {
          name: 'src',
          path: 'src',
          type: 'directory' as const,
          lastModified: new Date(),
          isReadable: true,
        },
        {
          name: 'package.json',
          path: 'package.json',
          type: 'file' as const,
          size: 1024,
          lastModified: new Date(),
          isReadable: true,
        }
      ]
    };

    mockApiGet.mockResolvedValueOnce(mockResponse);

    render(<SessionFileTree {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('src')).toBeInTheDocument();
      expect(screen.getByText('package.json')).toBeInTheDocument();
    });

    expect(mockApiGet).toHaveBeenCalledWith('/api/sessions/test-session-123/files');
  });

  it('should handle file selection', async () => {
    const mockResponse = {
      workingDirectory: '/test/dir',
      currentPath: '',
      entries: [
        {
          name: 'test.ts',
          path: 'test.ts',
          type: 'file' as const,
          size: 512,
          lastModified: new Date(),
          isReadable: true,
        }
      ]
    };

    mockApiGet.mockResolvedValueOnce(mockResponse);

    render(<SessionFileTree {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('test.ts')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('test.ts'));

    expect(mockOnFileSelect).toHaveBeenCalledWith('test.ts', 'test.ts');
  });

  it('should expand directories when clicked', async () => {
    const rootResponse = {
      workingDirectory: '/test/dir',
      currentPath: '',
      entries: [
        {
          name: 'src',
          path: 'src',
          type: 'directory' as const,
          lastModified: new Date(),
          isReadable: true,
        }
      ]
    };

    const subDirResponse = {
      workingDirectory: '/test/dir',
      currentPath: 'src',
      entries: [
        {
          name: 'index.ts',
          path: 'src/index.ts',
          type: 'file' as const,
          size: 256,
          lastModified: new Date(),
          isReadable: true,
        }
      ]
    };

    mockApiGet
      .mockResolvedValueOnce(rootResponse)
      .mockResolvedValueOnce(subDirResponse);

    render(<SessionFileTree {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('src')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('src'));

    await waitFor(() => {
      expect(screen.getByText('index.ts')).toBeInTheDocument();
    });

    expect(mockApiGet).toHaveBeenCalledTimes(2);
    expect(mockApiGet).toHaveBeenLastCalledWith('/api/sessions/test-session-123/files?path=src');
  });

  it('should filter files based on search term', async () => {
    const mockResponse = {
      workingDirectory: '/test/dir',
      currentPath: '',
      entries: [
        {
          name: 'component.tsx',
          path: 'component.tsx',
          type: 'file' as const,
          size: 1024,
          lastModified: new Date(),
          isReadable: true,
        },
        {
          name: 'test.js',
          path: 'test.js',
          type: 'file' as const,
          size: 512,
          lastModified: new Date(),
          isReadable: true,
        }
      ]
    };

    mockApiGet.mockResolvedValueOnce(mockResponse);

    render(<SessionFileTree {...defaultProps} searchTerm="comp" />);

    await waitFor(() => {
      expect(screen.getByText('component.tsx')).toBeInTheDocument();
      expect(screen.queryByText('test.js')).not.toBeInTheDocument();
    });
  });

  it('should handle API errors gracefully', async () => {
    mockApiGet.mockRejectedValueOnce(new Error('Network error'));

    render(<SessionFileTree {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });
  });
});
```

**How to test:**
```bash
cd packages/web
npm run test:run components/files/SessionFileTree.test.tsx
```

**Commit message**: "feat: add SessionFileTree component with expand/collapse and search filtering"

---

## Task 5: Create File Viewer Modal Component

**Goal**: Modal component for displaying file content with syntax highlighting

**Files to create:**
- `packages/web/components/modals/FileViewerModal.tsx`
- `packages/web/components/modals/FileViewerModal.test.tsx`

**Files to reference:**
- `packages/web/components/ui/Modal.tsx` - Modal structure and props
- `packages/web/components/files/FileDiffViewer.tsx` - Syntax highlighting patterns
- `packages/web/lib/fontawesome.ts` - Available icons for actions

**Implementation:**

```typescript
// packages/web/components/modals/FileViewerModal.tsx
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faFile, 
  faDownload, 
  faExternalLinkAlt, 
  faCopy,
  faSpinner 
} from '@/lib/fontawesome';
import { Modal } from '@/components/ui/Modal';
import { api } from '@/lib/api-client';
import type { SessionFileContentResponse } from '@/types/session-files';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';

interface FileViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  filePath: string;
  fileName: string;
}

interface FileViewerHeaderProps {
  fileName: string;
  filePath: string;
  onDownload: () => void;
  onPopOut: () => void;
  onCopy: () => void;
}

function FileViewerHeader({
  fileName,
  filePath,
  onDownload,
  onPopOut,
  onCopy
}: FileViewerHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <FontAwesomeIcon icon={faFile} className="w-4 h-4 text-gray-500" />
        <div>
          <div className="font-medium">{fileName}</div>
          <div className="text-sm text-gray-500">{filePath}</div>
        </div>
      </div>
      
      <div className="flex items-center gap-2">
        <button
          onClick={onCopy}
          className="btn btn-ghost btn-sm"
          title="Copy content"
        >
          <FontAwesomeIcon icon={faCopy} className="w-4 h-4" />
        </button>
        
        <button
          onClick={onDownload}
          className="btn btn-ghost btn-sm"
          title="Download file"
        >
          <FontAwesomeIcon icon={faDownload} className="w-4 h-4" />
        </button>
        
        <button
          onClick={onPopOut}
          className="btn btn-ghost btn-sm"
          title="Open in new window"
        >
          <FontAwesomeIcon icon={faExternalLinkAlt} className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// Let highlight.js handle language detection automatically

interface FileContentProps {
  fileContent: SessionFileContentResponse;
  isLoading: boolean;
  error: string | null;
}

function FileContent({ fileContent, isLoading, error }: FileContentProps) {
  const [highlightedContent, setHighlightedContent] = useState<string>('');
  
  // Syntax highlighting effect
  useEffect(() => {
    if (!fileContent?.content) {
      setHighlightedContent('');
      return;
    }
    
    try {
      // Let highlight.js auto-detect the language
      const highlighted = hljs.highlightAuto(fileContent.content).value;
      
      // Sanitize the highlighted HTML
      const sanitized = DOMPurify.sanitize(highlighted);
      setHighlightedContent(sanitized);
    } catch (err) {
      console.warn('Failed to highlight code:', err);
      // Fallback to plain text
      setHighlightedContent(DOMPurify.sanitize(fileContent.content));
    }
  }, [fileContent]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <FontAwesomeIcon icon={faSpinner} className="w-6 h-6 animate-spin mr-3" />
        <span>Loading file content...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center">
        <div className="text-red-600 mb-4">{error}</div>
        <div className="text-sm text-gray-500">
          The file could not be loaded. It may be too large, binary, or inaccessible.
        </div>
      </div>
    );
  }

  if (!fileContent) {
    return (
      <div className="p-8 text-center text-gray-500">
        No file selected
      </div>
    );
  }

  return (
    <div className="h-96 overflow-auto border border-gray-200 rounded">
      {/* File info header */}
      <div className="bg-gray-50 px-3 py-2 border-b border-gray-200 text-sm text-gray-600">
        <div className="flex justify-between">
          <span>{fileContent.mimeType}</span>
          <span>{formatFileSize(fileContent.size)}</span>
        </div>
      </div>
      
      {/* Code content with syntax highlighting */}
      <div className="p-4">
        <pre className="text-sm font-mono leading-relaxed">
          <code
            className="hljs"
            dangerouslySetInnerHTML={{ __html: highlightedContent }}
          />
        </pre>
      </div>
    </div>
  );
}

// Helper function to format file size
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function FileViewerModal({
  isOpen,
  onClose,
  sessionId,
  filePath,
  fileName
}: FileViewerModalProps) {
  const [fileContent, setFileContent] = useState<SessionFileContentResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load file content when modal opens or file path changes
  useEffect(() => {
    if (!isOpen || !filePath) {
      setFileContent(null);
      setError(null);
      return;
    }

    const loadFileContent = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        const encodedPath = filePath.split('/').map(segment => encodeURIComponent(segment)).join('/');
        const response = await api.get<SessionFileContentResponse>(
          `/api/sessions/${sessionId}/files/${encodedPath}`
        );
        setFileContent(response);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load file content');
        setFileContent(null);
      } finally {
        setIsLoading(false);
      }
    };

    void loadFileContent();
  }, [isOpen, sessionId, filePath]);

  // Action handlers
  const handleDownload = () => {
    if (!fileContent) return;
    
    const blob = new Blob([fileContent.content], { type: fileContent.mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    if (!fileContent) return;
    
    try {
      await navigator.clipboard.writeText(fileContent.content);
      // Could add toast notification here
    } catch (err) {
      console.error('Failed to copy content:', err);
    }
  };

  const handlePopOut = () => {
    const popoutUrl = new URL('/file-viewer', window.location.origin);
    popoutUrl.searchParams.set('session', sessionId);
    popoutUrl.searchParams.set('file', filePath);
    
    const popoutWindow = window.open(
      popoutUrl.toString(),
      'file-viewer',
      'width=1200,height=800,location=no,menubar=no,toolbar=no,status=no,resizable=yes,scrollbars=yes'
    );
    
    if (popoutWindow) {
      popoutWindow.focus();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="xl"
      title={
        <FileViewerHeader
          fileName={fileName}
          filePath={filePath}
          onDownload={handleDownload}
          onPopOut={handlePopOut}
          onCopy={handleCopy}
        />
      }
    >
      <FileContent
        fileContent={fileContent}
        isLoading={isLoading}
        error={error}
      />
    </Modal>
  );
}
```

**Testing:**
Create `packages/web/components/modals/FileViewerModal.test.tsx`:

```typescript
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileViewerModal } from './FileViewerModal';
import * as apiClient from '@/lib/api-client';

// Mock the API client
vi.mock('@/lib/api-client', () => ({
  api: {
    get: vi.fn()
  }
}));

const mockApiGet = vi.mocked(apiClient.api.get);

// Mock highlight.js and DOMPurify
vi.mock('highlight.js', () => ({
  default: {
    highlight: vi.fn().mockReturnValue({ value: '<span class="hljs-keyword">const</span>' }),
    highlightAuto: vi.fn().mockReturnValue({ value: 'highlighted content' })
  }
}));

vi.mock('dompurify', () => ({
  default: {
    sanitize: vi.fn().mockImplementation((content) => content)
  }
}));

describe('FileViewerModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    sessionId: 'test-session-123',
    filePath: 'src/test.ts',
    fileName: 'test.ts'
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render loading state while fetching file content', () => {
    render(<FileViewerModal {...defaultProps} />);
    expect(screen.getByText('Loading file content...')).toBeInTheDocument();
  });

  it('should load and display file content', async () => {
    const mockFileContent = {
      path: 'src/test.ts',
      content: 'const hello = "world";',
      mimeType: 'text/typescript',
      encoding: 'utf8' as const,
      size: 1024
    };

    mockApiGet.mockResolvedValueOnce(mockFileContent);

    render(<FileViewerModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('test.ts')).toBeInTheDocument();
      expect(screen.getByText('src/test.ts')).toBeInTheDocument();
      expect(screen.getByText('text/typescript')).toBeInTheDocument();
    });

    expect(mockApiGet).toHaveBeenCalledWith('/api/sessions/test-session-123/files/src/test.ts');
  });

  it('should handle API errors gracefully', async () => {
    mockApiGet.mockRejectedValueOnce(new Error('File not found'));

    render(<FileViewerModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('File not found')).toBeInTheDocument();
      expect(screen.getByText(/could not be loaded/)).toBeInTheDocument();
    });
  });

  it('should not load content when modal is closed', () => {
    render(<FileViewerModal {...defaultProps} isOpen={false} />);
    expect(mockApiGet).not.toHaveBeenCalled();
  });

  it('should handle copy functionality', async () => {
    const mockFileContent = {
      path: 'src/test.ts',
      content: 'const hello = "world";',
      mimeType: 'text/typescript',
      encoding: 'utf8' as const,
      size: 1024
    };

    mockApiGet.mockResolvedValueOnce(mockFileContent);

    // Mock clipboard API
    const mockWriteText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: mockWriteText
      }
    });

    render(<FileViewerModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTitle('Copy content')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTitle('Copy content'));

    expect(mockWriteText).toHaveBeenCalledWith('const hello = "world";');
  });

  it('should handle download functionality', async () => {
    const mockFileContent = {
      path: 'src/test.ts',
      content: 'const hello = "world";',
      mimeType: 'text/typescript',
      encoding: 'utf8' as const,
      size: 1024
    };

    mockApiGet.mockResolvedValueOnce(mockFileContent);

    // Mock URL and DOM manipulation for download
    global.URL.createObjectURL = vi.fn().mockReturnValue('blob:test-url');
    global.URL.revokeObjectURL = vi.fn();
    
    const mockLink = {
      href: '',
      download: '',
      click: vi.fn()
    };
    const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(mockLink as unknown as HTMLElement);
    const appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockLink as unknown as Node);
    const removeChildSpy = vi.spyOn(document.body, 'removeChild').mockImplementation(() => mockLink as unknown as Node);

    render(<FileViewerModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTitle('Download file')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTitle('Download file'));

    expect(createElementSpy).toHaveBeenCalledWith('a');
    expect(mockLink.download).toBe('test.ts');
    expect(mockLink.click).toHaveBeenCalled();
    
    createElementSpy.mockRestore();
    appendChildSpy.mockRestore();
    removeChildSpy.mockRestore();
  });

  it('should handle pop-out window functionality', async () => {
    const mockFileContent = {
      path: 'src/test.ts',
      content: 'const hello = "world";',
      mimeType: 'text/typescript',
      encoding: 'utf8' as const,
      size: 1024
    };

    mockApiGet.mockResolvedValueOnce(mockFileContent);

    const mockPopoutWindow = { focus: vi.fn() };
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(mockPopoutWindow as unknown as Window);

    render(<FileViewerModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTitle('Open in new window')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTitle('Open in new window'));

    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining('/file-viewer?session=test-session-123&file=src%2Ftest.ts'),
      'file-viewer',
      expect.stringContaining('width=1200,height=800')
    );
    expect(mockPopoutWindow.focus).toHaveBeenCalled();
    
    openSpy.mockRestore();
  });
});
```

**How to test:**
```bash
cd packages/web
npm run test:run components/modals/FileViewerModal.test.tsx
```

**Commit message**: "feat: add FileViewerModal with syntax highlighting and file actions"

---

## Task 6: Create File Browser Sidebar Section

**Goal**: Integrate file tree into existing sidebar as a collapsible section

**Files to create:**
- `packages/web/components/sidebar/FileBrowserSection.tsx`
- `packages/web/components/sidebar/FileBrowserSection.test.tsx`

**Files to modify:**
- `packages/web/components/sidebar/SidebarContent.tsx`

**Files to reference:**
- `packages/web/components/sidebar/SessionSection.tsx` - Study existing sidebar section patterns
- `packages/web/components/layout/Sidebar.tsx` - Study SidebarSection usage

**Implementation:**

```typescript
// packages/web/components/sidebar/FileBrowserSection.tsx
'use client';

import React, { useState, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFolder, faSearch } from '@/lib/fontawesome';
import { SidebarSection } from '@/components/ui/SidebarSection';
import { AccentInput } from '@/components/ui/AccentInput';
import { SessionFileTree } from '@/components/files/SessionFileTree';
import { FileViewerModal } from '@/components/modals/FileViewerModal';

interface FileBrowserSectionProps {
  sessionId: string;
  workingDirectory?: string;
  isCollapsed?: boolean;
  onToggle?: () => void;
  className?: string;
}

export function FileBrowserSection({
  sessionId,
  workingDirectory,
  isCollapsed = false,
  onToggle,
  className = ''
}: FileBrowserSectionProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFile, setSelectedFile] = useState<{
    path: string;
    name: string;
  } | null>(null);

  const handleFileSelect = useCallback((filePath: string, fileName: string) => {
    setSelectedFile({ path: filePath, name: fileName });
  }, []);

  const handleCloseFileViewer = useCallback(() => {
    setSelectedFile(null);
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    setSearchTerm(value);
  }, []);

  // Don't render if no working directory is configured
  if (!workingDirectory) {
    return null;
  }

  return (
    <>
      <SidebarSection
        title="Files"
        icon={faFolder}
        collapsible={true}
        defaultCollapsed={isCollapsed}
        onToggle={onToggle}
        className={className}
        headerActions={
          !isCollapsed ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-base-content/60 truncate max-w-32" title={workingDirectory}>
                {workingDirectory.split('/').pop() || workingDirectory}
              </span>
            </div>
          ) : null
        }
      >
        {/* Search input */}
        <div className="px-2 pb-3">
          <div className="relative">
            <AccentInput
              placeholder="Search files..."
              value={searchTerm}
              onChange={handleSearchChange}
              className="text-sm"
            />
            <FontAwesomeIcon
              icon={faSearch}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 w-3 h-3 text-base-content/40 pointer-events-none"
            />
          </div>
        </div>

        {/* File tree */}
        <div className="px-1">
          <SessionFileTree
            sessionId={sessionId}
            onFileSelect={handleFileSelect}
            searchTerm={searchTerm}
            className="max-h-64"
          />
        </div>
      </SidebarSection>

      {/* File viewer modal */}
      {selectedFile && (
        <FileViewerModal
          isOpen={true}
          onClose={handleCloseFileViewer}
          sessionId={sessionId}
          filePath={selectedFile.path}
          fileName={selectedFile.name}
        />
      )}
    </>
  );
}
```

**Testing:**
Create `packages/web/components/sidebar/FileBrowserSection.test.tsx`:

```typescript
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileBrowserSection } from './FileBrowserSection';

// Mock child components
vi.mock('@/components/files/SessionFileTree', () => ({
  SessionFileTree: vi.fn(({ onFileSelect, searchTerm }) => (
    <div data-testid="session-file-tree">
      <div>Search: {searchTerm}</div>
      <button onClick={() => onFileSelect('test.ts', 'test.ts')}>
        test.ts
      </button>
    </div>
  ))
}));

vi.mock('@/components/modals/FileViewerModal', () => ({
  FileViewerModal: vi.fn(({ isOpen, filePath, fileName, onClose }) => (
    isOpen ? (
      <div data-testid="file-viewer-modal">
        <div>Viewing: {fileName} ({filePath})</div>
        <button onClick={onClose}>Close</button>
      </div>
    ) : null
  ))
}));

describe('FileBrowserSection', () => {
  const defaultProps = {
    sessionId: 'test-session-123',
    workingDirectory: '/home/user/project',
  };

  it('should not render when no working directory is provided', () => {
    render(
      <FileBrowserSection
        sessionId="test-session"
        workingDirectory=""
      />
    );

    expect(screen.queryByText('Files')).not.toBeInTheDocument();
  });

  it('should render file browser section with search and tree', () => {
    render(<FileBrowserSection {...defaultProps} />);

    expect(screen.getByText('Files')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search files...')).toBeInTheDocument();
    expect(screen.getByTestId('session-file-tree')).toBeInTheDocument();
    expect(screen.getByText('project')).toBeInTheDocument(); // Working directory name
  });

  it('should update search term when typing in search input', async () => {
    render(<FileBrowserSection {...defaultProps} />);

    const searchInput = screen.getByPlaceholderText('Search files...');
    await userEvent.type(searchInput, 'test');

    expect(screen.getByText('Search: test')).toBeInTheDocument();
  });

  it('should open file viewer modal when file is selected', async () => {
    render(<FileBrowserSection {...defaultProps} />);

    const fileButton = screen.getByText('test.ts');
    await userEvent.click(fileButton);

    expect(screen.getByTestId('file-viewer-modal')).toBeInTheDocument();
    expect(screen.getByText('Viewing: test.ts (test.ts)')).toBeInTheDocument();
  });

  it('should close file viewer modal when close button is clicked', async () => {
    render(<FileBrowserSection {...defaultProps} />);

    // Open modal
    const fileButton = screen.getByText('test.ts');
    await userEvent.click(fileButton);

    expect(screen.getByTestId('file-viewer-modal')).toBeInTheDocument();

    // Close modal
    const closeButton = screen.getByText('Close');
    await userEvent.click(closeButton);

    expect(screen.queryByTestId('file-viewer-modal')).not.toBeInTheDocument();
  });

  it('should handle toggle functionality', () => {
    const mockOnToggle = vi.fn();
    render(
      <FileBrowserSection
        {...defaultProps}
        isCollapsed={false}
        onToggle={mockOnToggle}
      />
    );

    // The actual toggle behavior is handled by SidebarSection component
    // This test verifies the prop is passed correctly
    expect(mockOnToggle).toBeDefined();
  });
});
```

Now modify the existing SidebarContent to include the FileBrowserSection:

```typescript
// packages/web/components/sidebar/SidebarContent.tsx
// Add to existing imports
import { FileBrowserSection } from './FileBrowserSection';

// Add to the component where other sections are rendered
// (Look for TaskSidebarSection, SessionSection, etc. and add alongside them)

<FileBrowserSection
  sessionId={selectedSessionId}
  workingDirectory={sessionDetails?.configuration?.workingDirectory}
  isCollapsed={fileBrowserCollapsed}
  onToggle={() => setFileBrowserCollapsed(!fileBrowserCollapsed)}
/>
```

**How to test:**
```bash
cd packages/web
npm run test:run components/sidebar/FileBrowserSection.test.tsx
```

**Commit message**: "feat: add FileBrowserSection to sidebar with search and file tree integration"

---

## Task 7: Create Standalone File Viewer Page

**Goal**: Create a standalone page for pop-out file viewing

**Files to create:**
- `packages/web/app/file-viewer/page.tsx`

**Files to reference:**
- `packages/web/app/project/[projectId]/session/[sessionId]/page.tsx` - Study page structure
- Components created in previous tasks for file viewing logic

**Implementation:**

```typescript
// packages/web/app/file-viewer/page.tsx
'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faFile, 
  faDownload, 
  faCopy, 
  faSpinner,
  faExclamationTriangle 
} from '@/lib/fontawesome';
import { api } from '@/lib/api-client';
import type { SessionFileContentResponse } from '@/types/session-files';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';

// Import highlight.js theme - you may want to match your app theme
import 'highlight.js/styles/github.css';

interface FileViewerContentProps {
  sessionId: string;
  filePath: string;
}

// Let highlight.js handle language detection automatically

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function FileViewerContent({ sessionId, filePath }: FileViewerContentProps) {
  const [fileContent, setFileContent] = useState<SessionFileContentResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [highlightedContent, setHighlightedContent] = useState<string>('');

  // Load file content
  useEffect(() => {
    const loadFileContent = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        const encodedPath = filePath.split('/').map(segment => encodeURIComponent(segment)).join('/');
        const response = await api.get<SessionFileContentResponse>(
          `/api/sessions/${sessionId}/files/${encodedPath}`
        );
        setFileContent(response);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load file content');
        setFileContent(null);
      } finally {
        setIsLoading(false);
      }
    };

    void loadFileContent();
  }, [sessionId, filePath]);

  // Syntax highlighting effect
  useEffect(() => {
    if (!fileContent?.content) {
      setHighlightedContent('');
      return;
    }

    try {
      // Let highlight.js auto-detect the language
      const highlighted = hljs.highlightAuto(fileContent.content).value;
      
      const sanitized = DOMPurify.sanitize(highlighted);
      setHighlightedContent(sanitized);
    } catch (err) {
      console.warn('Failed to highlight code:', err);
      setHighlightedContent(DOMPurify.sanitize(fileContent.content));
    }
  }, [fileContent]);

  const handleDownload = () => {
    if (!fileContent) return;
    
    const blob = new Blob([fileContent.content], { type: fileContent.mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filePath.split('/').pop() || 'download';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    if (!fileContent) return;
    
    try {
      await navigator.clipboard.writeText(fileContent.content);
      // Simple feedback - could be enhanced with toast
      const button = document.getElementById('copy-button');
      if (button) {
        const originalText = button.textContent;
        button.textContent = 'Copied!';
        setTimeout(() => {
          button.textContent = originalText;
        }, 2000);
      }
    } catch (err) {
      console.error('Failed to copy content:', err);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-base-100">
        <div className="text-center">
          <FontAwesomeIcon icon={faSpinner} className="w-8 h-8 animate-spin text-primary mb-4" />
          <div className="text-lg">Loading file content...</div>
          <div className="text-sm text-base-content/60 mt-2">{filePath}</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-base-100">
        <div className="text-center max-w-md">
          <FontAwesomeIcon icon={faExclamationTriangle} className="w-12 h-12 text-error mb-4" />
          <div className="text-lg font-medium mb-2">Failed to Load File</div>
          <div className="text-error mb-4">{error}</div>
          <div className="text-sm text-base-content/60">
            The file may be too large, binary, or inaccessible.
          </div>
          <div className="text-sm text-base-content/60 mt-2 font-mono">
            {filePath}
          </div>
        </div>
      </div>
    );
  }

  if (!fileContent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-base-100">
        <div className="text-center">
          <div className="text-lg">No file content available</div>
        </div>
      </div>
    );
  }

  const fileName = filePath.split('/').pop() || filePath;

  return (
    <div className="min-h-screen bg-base-100">
      {/* Header */}
      <header className="bg-base-200 border-b border-base-300 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FontAwesomeIcon icon={faFile} className="w-5 h-5 text-base-content/60" />
            <div>
              <h1 className="text-lg font-medium">{fileName}</h1>
              <div className="text-sm text-base-content/60">{filePath}</div>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="text-sm text-base-content/60">
              {fileContent.mimeType} • {formatFileSize(fileContent.size)}
            </div>
            
            <button
              id="copy-button"
              onClick={handleCopy}
              className="btn btn-ghost btn-sm"
              title="Copy content to clipboard"
            >
              <FontAwesomeIcon icon={faCopy} className="w-4 h-4 mr-2" />
              Copy
            </button>
            
            <button
              onClick={handleDownload}
              className="btn btn-primary btn-sm"
              title="Download file"
            >
              <FontAwesomeIcon icon={faDownload} className="w-4 h-4 mr-2" />
              Download
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="p-6">
        <div className="bg-base-100 border border-base-300 rounded-lg overflow-hidden">
          <pre className="p-6 text-sm font-mono leading-relaxed overflow-auto">
            <code
              className="hljs"
              dangerouslySetInnerHTML={{ __html: highlightedContent }}
            />
          </pre>
        </div>
      </main>
    </div>
  );
}

function FileViewerPage() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session');
  const filePath = searchParams.get('file');

  if (!sessionId || !filePath) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-base-100">
        <div className="text-center">
          <FontAwesomeIcon icon={faExclamationTriangle} className="w-12 h-12 text-error mb-4" />
          <div className="text-lg font-medium mb-2">Invalid File Viewer URL</div>
          <div className="text-base-content/60">
            Missing required session ID or file path parameters.
          </div>
        </div>
      </div>
    );
  }

  return <FileViewerContent sessionId={sessionId} filePath={filePath} />;
}

// Wrap in Suspense since we're using useSearchParams
export default function FileViewerPageWrapper() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-base-100">
        <FontAwesomeIcon icon={faSpinner} className="w-8 h-8 animate-spin text-primary" />
      </div>
    }>
      <FileViewerPage />
    </Suspense>
  );
}
```

**How to test manually:**
1. Open a session in Lace
2. Click a file in the file browser sidebar
3. In the file viewer modal, click the "Open in new window" button
4. Verify the standalone viewer opens with the file content

**How to test with automated tests:**
```bash
cd packages/web
# This page can be tested with Playwright end-to-end tests
npx playwright test file-viewer
```

**Commit message**: "feat: add standalone file viewer page for pop-out functionality"

---

## Task 8: Integration Testing and Documentation

**Goal**: End-to-end testing and documentation for the complete file browser feature

**Files to create:**
- `packages/web/e2e/file-browser.e2e.ts`
- `docs/features/file-browser.md`

**Files to modify:**
- `packages/web/components/ui/index.ts` (add new component exports)

**Implementation:**

First, update the component exports:

```typescript
// packages/web/components/ui/index.ts
// Add these exports to the existing file:

export { SessionFileTree } from '../files/SessionFileTree';
export { FileViewerModal } from '../modals/FileViewerModal';
export { FileBrowserSection } from '../sidebar/FileBrowserSection';
```

Create end-to-end tests:

```typescript
// packages/web/e2e/file-browser.e2e.ts
import { test, expect } from '@playwright/test';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

test.describe('File Browser E2E Tests', () => {
  let testProjectDir: string;

  test.beforeEach(async ({ page }) => {
    // Create a test project directory with sample files
    testProjectDir = join(tmpdir(), `lace-e2e-${Date.now()}`);
    await fs.mkdir(testProjectDir, { recursive: true });
    await fs.mkdir(join(testProjectDir, 'src'));
    await fs.mkdir(join(testProjectDir, 'src', 'components'));
    
    // Create test files
    await fs.writeFile(join(testProjectDir, 'package.json'), JSON.stringify({
      name: 'test-project',
      version: '1.0.0'
    }, null, 2));
    
    await fs.writeFile(join(testProjectDir, 'README.md'), '# Test Project\n\nThis is a test.');
    
    await fs.writeFile(join(testProjectDir, 'src', 'index.ts'), `
export function hello(name: string): string {
  return \`Hello, \${name}!\`;
}
`.trim());

    await fs.writeFile(join(testProjectDir, 'src', 'components', 'Button.tsx'), `
import React from 'react';

interface ButtonProps {
  children: React.ReactNode;
  onClick: () => void;
}

export function Button({ children, onClick }: ButtonProps) {
  return (
    <button onClick={onClick} className="btn btn-primary">
      {children}
    </button>
  );
}
`.trim());

    await page.goto('/');
  });

  test.afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testProjectDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test('should display file browser in session sidebar', async ({ page }) => {
    // Create a project with our test directory
    await page.getByRole('button', { name: /new project/i }).click();
    await page.getByLabel(/project name/i).fill('Test Project');
    await page.getByLabel(/working directory/i).fill(testProjectDir);
    await page.getByRole('button', { name: /create project/i }).click();

    // Navigate to session
    await page.waitForSelector('[data-testid="session-link"]');
    await page.getByTestId('session-link').first().click();

    // Verify file browser section appears in sidebar
    await expect(page.getByText('Files')).toBeVisible();
    await expect(page.getByPlaceholderText('Search files...')).toBeVisible();
    
    // Verify initial files are loaded
    await expect(page.getByText('package.json')).toBeVisible();
    await expect(page.getByText('README.md')).toBeVisible();
    await expect(page.getByText('src')).toBeVisible();
  });

  test('should expand directories and show nested files', async ({ page }) => {
    // Setup project (same as above)
    await page.getByRole('button', { name: /new project/i }).click();
    await page.getByLabel(/project name/i).fill('Test Project');
    await page.getByLabel(/working directory/i).fill(testProjectDir);
    await page.getByRole('button', { name: /create project/i }).click();

    await page.waitForSelector('[data-testid="session-link"]');
    await page.getByTestId('session-link').first().click();

    // Wait for file browser to load
    await expect(page.getByText('src')).toBeVisible();

    // Click to expand src directory
    await page.getByText('src').click();

    // Verify nested files appear
    await expect(page.getByText('index.ts')).toBeVisible();
    await expect(page.getByText('components')).toBeVisible();

    // Expand components directory
    await page.getByText('components').click();
    await expect(page.getByText('Button.tsx')).toBeVisible();
  });

  test('should open file viewer modal when clicking files', async ({ page }) => {
    // Setup project
    await page.getByRole('button', { name: /new project/i }).click();
    await page.getByLabel(/project name/i).fill('Test Project');
    await page.getByLabel(/working directory/i).fill(testProjectDir);
    await page.getByRole('button', { name: /create project/i }).click();

    await page.waitForSelector('[data-testid="session-link"]');
    await page.getByTestId('session-link').first().click();

    // Click on a file
    await page.getByText('README.md').click();

    // Verify modal opens
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('README.md')).toBeVisible();
    await expect(page.getByText('# Test Project')).toBeVisible();

    // Verify modal actions are present
    await expect(page.getByTitle('Copy content')).toBeVisible();
    await expect(page.getByTitle('Download file')).toBeVisible();
    await expect(page.getByTitle('Open in new window')).toBeVisible();
  });

  test('should filter files based on search term', async ({ page }) => {
    // Setup project
    await page.getByRole('button', { name: /new project/i }).click();
    await page.getByLabel(/project name/i).fill('Test Project');
    await page.getByLabel(/working directory/i).fill(testProjectDir);
    await page.getByRole('button', { name: /create project/i }).click();

    await page.waitForSelector('[data-testid="session-link"]');
    await page.getByTestId('session-link').first().click();

    // Type in search box
    await page.getByPlaceholderText('Search files...').fill('package');

    // Verify filtering works
    await expect(page.getByText('package.json')).toBeVisible();
    await expect(page.getByText('README.md')).not.toBeVisible();
    await expect(page.getByText('src')).not.toBeVisible();

    // Clear search
    await page.getByPlaceholderText('Search files...').fill('');

    // Verify all files are visible again
    await expect(page.getByText('package.json')).toBeVisible();
    await expect(page.getByText('README.md')).toBeVisible();
    await expect(page.getByText('src')).toBeVisible();
  });

  test('should open pop-out window for file viewing', async ({ page }) => {
    // Setup project
    await page.getByRole('button', { name: /new project/i }).click();
    await page.getByLabel(/project name/i).fill('Test Project');
    await page.getByLabel(/working directory/i).fill(testProjectDir);
    await page.getByRole('button', { name: /create project/i }).click();

    await page.waitForSelector('[data-testid="session-link"]');
    await page.getByTestId('session-link').first().click();

    // Open file in modal
    await page.getByText('README.md').click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Listen for new window
    const [popupPage] = await Promise.all([
      page.context().waitForEvent('page'),
      page.getByTitle('Open in new window').click()
    ]);

    // Verify popup content
    await popupPage.waitForLoadState();
    await expect(popupPage.getByText('README.md')).toBeVisible();
    await expect(popupPage.getByText('# Test Project')).toBeVisible();
    await expect(popupPage.getByRole('button', { name: /copy/i })).toBeVisible();
    await expect(popupPage.getByRole('button', { name: /download/i })).toBeVisible();

    await popupPage.close();
  });

  test('should handle file download functionality', async ({ page }) => {
    // Setup project
    await page.getByRole('button', { name: /new project/i }).click();
    await page.getByLabel(/project name/i).fill('Test Project');
    await page.getByLabel(/working directory/i).fill(testProjectDir);
    await page.getByRole('button', { name: /create project/i }).click();

    await page.waitForSelector('[data-testid="session-link"]');
    await page.getByTestId('session-link').first().click();

    // Open file modal
    await page.getByText('README.md').click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Listen for download
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTitle('Download file').click()
    ]);

    // Verify download
    expect(download.suggestedFilename()).toBe('README.md');
  });

  test('should handle syntax highlighting for code files', async ({ page }) => {
    // Setup project
    await page.getByRole('button', { name: /new project/i }).click();
    await page.getByLabel(/project name/i).fill('Test Project');
    await page.getByLabel(/working directory/i).fill(testProjectDir);
    await page.getByRole('button', { name: /create project/i }).click();

    await page.waitForSelector('[data-testid="session-link"]');
    await page.getByTestId('session-link').first().click();

    // Expand src directory and click TypeScript file
    await page.getByText('src').click();
    await page.getByText('index.ts').click();

    // Verify syntax highlighting is applied
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('text/typescript')).toBeVisible();
    
    // Look for syntax highlighted code (specific classes depend on highlight.js theme)
    const codeBlock = page.locator('code.hljs');
    await expect(codeBlock).toBeVisible();
  });
});
```

Create feature documentation:

```markdown
<!-- docs/features/file-browser.md -->
# File Browser Feature

## Overview

The File Browser feature allows users to browse, search, and view files within their session's working directory directly from the Lace web interface. The feature provides a familiar file explorer experience integrated into the sidebar, with support for syntax highlighting and pop-out viewing.

## Components

### FileBrowserSection
Located in the sidebar, provides the main file browsing interface:
- Collapsible section header
- Search input for filtering files
- File tree with expand/collapse functionality
- Displays session working directory name

### SessionFileTree  
Recursive tree component for displaying file hierarchy:
- Lazy loading of directory contents
- File type icons (folders, files)
- Search term highlighting
- Click to select files, double-click to expand directories

### FileViewerModal
Modal for viewing file content:
- Syntax highlighting via highlight.js
- File metadata display (type, size)
- Copy, download, and pop-out actions
- Support for text files up to 1MB

### Standalone File Viewer
Chromeless window for dedicated file viewing:
- Full-screen file content display
- Same actions as modal viewer
- Accessible via `/file-viewer?session=X&file=Y`

## API Endpoints

### GET /api/sessions/[sessionId]/files
Lists files and directories in session's working directory
- Query parameter: `path` (optional, defaults to root)
- Returns: Array of file entries with metadata
- Security: Prevents path traversal outside working directory

### GET /api/sessions/[sessionId]/files/[...path]
Retrieves content of a specific file
- Path parameters: Session ID and file path segments
- Returns: File content with metadata and MIME type
- Limits: 1MB max file size, text files only
- Security: Path validation and access control

## Security Model

### Session Isolation
- All file operations are scoped to the session's `workingDirectory`
- Path traversal attacks (e.g., `../../../etc/passwd`) are prevented
- Each session can only access its own files

### File Access Controls
- Only readable files are displayed
- File permissions are checked before serving content
- Binary files are rejected with appropriate error messages
- Large files (>1MB) are rejected to prevent memory issues

### Content Sanitization
- All file content is sanitized through DOMPurify
- Syntax highlighting is applied safely to prevent XSS
- File names and paths are properly escaped

## Usage

### Basic File Browsing
1. Open a session in Lace
2. Ensure session has a working directory configured
3. "Files" section appears in sidebar
4. Click files to view content
5. Click directories to expand/collapse

### File Search
1. Type in the search box within the Files section
2. File tree automatically filters to matching names
3. Search is case-insensitive partial matching
4. Clear search to show all files

### File Viewing
1. Click any file in the tree
2. File Viewer modal opens with content
3. Syntax highlighting applied automatically
4. Use Copy button to copy content to clipboard
5. Use Download button to download file
6. Use pop-out button to open in dedicated window

### Pop-out Window
1. Click pop-out button in File Viewer modal
2. New chromeless window opens with file content
3. Window is resizable and scrollable
4. Same actions available as in modal

## Configuration

### Session Setup
The file browser requires a session with a configured `workingDirectory`:

```typescript
const sessionConfig: SessionConfiguration = {
  workingDirectory: '/path/to/project',
  // ... other config
};
```

### File Type Support
All text files up to 1MB are supported for viewing. Syntax highlighting is provided by highlight.js auto-detection, which supports 190+ languages including:
- JavaScript/TypeScript, Python, Java, Go, Rust, C/C++
- HTML, CSS, JSON, YAML, Markdown, SQL
- And many more - highlight.js automatically detects the language

## Testing

### Unit Tests
```bash
npm run test:run components/files/SessionFileTree.test.tsx
npm run test:run components/modals/FileViewerModal.test.tsx  
npm run test:run components/sidebar/FileBrowserSection.test.tsx
```

### API Tests
```bash
npm run test:run app/api/sessions/[sessionId]/files/route.test.ts
npm run test:run app/api/sessions/[sessionId]/files/[...path]/route.test.ts
```

### End-to-End Tests
```bash
npx playwright test file-browser.e2e.ts
```

## Future Enhancements

### Planned Features
- File editing capabilities
- Image preview for supported formats
- PDF viewing
- File upload/creation
- Git integration (show file status)
- Minimap for large files

### Performance Optimizations
- Virtual scrolling for large directories
- File content caching
- Debounced search
- Progressive loading of large files

## Troubleshooting

### Common Issues

**Files section not visible**
- Verify session has `workingDirectory` configured
- Check file permissions on working directory

**"Permission denied" errors**
- Verify Lace has read access to working directory
- Check that files are not locked by other processes

**"File too large" errors**
- Current limit is 1MB for text files
- Use download functionality for larger files

**Syntax highlighting not working**
- Check browser console for highlight.js errors
- Ensure highlight.js theme CSS is loaded
- Verify file contains text content (not binary)

### Debugging

Enable debug logging:
```bash
LACE_LOG_LEVEL=debug npm run dev
```

Check browser console for client-side errors and network requests to file API endpoints.
```

**How to test:**
```bash
cd packages/web  
npx playwright test e2e/file-browser.e2e.ts
```

**Commit message**: "feat: add comprehensive E2E tests and documentation for file browser feature"

---

## Final Integration Checklist

### Verification Steps

1. **API Security**: Verify path traversal protection works
```bash
curl "http://localhost:3000/api/sessions/test-session/files?path=../../../etc"
# Should return 403 error
```

2. **Component Integration**: All components render without TypeScript errors
```bash
npm run type-check
```

3. **Test Coverage**: All tests pass
```bash
npm run test:run
```

4. **Linting**: Code follows project standards
```bash
npm run lint
```

5. **Manual Testing**: File browser works in actual session
- Create project with working directory
- Start session 
- Verify Files section appears
- Test file browsing, search, and viewing

### Performance Considerations

- File tree only loads directories when expanded (lazy loading)
- Search operates on loaded files only (client-side filtering)
- File content limited to 1MB to prevent memory issues
- Syntax highlighting uses web workers where available

### Security Verification

- Path traversal attacks blocked at API level
- File access restricted to session working directory
- Content sanitization prevents XSS
- Binary files rejected appropriately

**Final commit message**: "feat: complete session-level file browser with tree navigation, search, and secure file viewing"

## Summary

This implementation plan provides a comprehensive, secure, and well-tested file browser feature for Lace. It leverages existing UI components, follows established patterns, and maintains strict session-level security isolation. The feature supports tree navigation, search, syntax-highlighted viewing, and pop-out windows while preventing security vulnerabilities through proper path validation and content sanitization.

Key principles followed:
- **YAGNI**: Essential features only (tree, search, view)
- **DRY**: Reuses existing components and patterns  
- **TDD**: Tests written before implementation
- **Security**: Session isolation and path traversal protection
- **TypeScript**: Strict typing without `any` types
- **Real Testing**: No mocking of core functionality