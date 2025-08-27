// ABOUTME: API endpoint for listing files in a session's working directory
// ABOUTME: Provides session-scoped file browsing with path traversal protection and proper error handling

import { NextRequest } from 'next/server';
import { promises as fs, constants as fsConstants } from 'fs';
import { join, resolve, relative, basename } from 'path';
import { createSuccessResponse, createErrorResponse } from '@/lib/server/api-utils';
import { SessionService } from '@/lib/server/session-service';
import { asThreadId } from '@/types/core';
import {
  ListSessionDirectoryRequestSchema,
  type SessionDirectoryResponse,
  type SessionFileEntry,
} from '@/types/session-files';

export async function GET(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
    const { searchParams } = new URL(request.url);
    const rawPath = searchParams.get('path') || '';

    // Validate request
    const parseResult = ListSessionDirectoryRequestSchema.safeParse({ path: rawPath });
    if (!parseResult.success) {
      return createErrorResponse(
        'Invalid request parameters',
        400,
        { 
          code: 'INVALID_REQUEST',
          details: parseResult.error.flatten()
        }
      );
    }
    const { path: requestedPath } = parseResult.data;

    const { sessionId } = params;

    // Get session and working directory
    const sessionService = new SessionService();
    const session = await sessionService.getSession(asThreadId(sessionId));

    if (!session) {
      return createErrorResponse('Session not found', 404, { code: 'SESSION_NOT_FOUND' });
    }

    const workingDirectory = session.getWorkingDirectory();

    if (!workingDirectory) {
      return createErrorResponse('Session has no working directory configured', 400, {
        code: 'NO_WORKING_DIRECTORY',
      });
    }

    // Security: Use realpath to resolve symlinks and prevent traversal outside working directory
    let realWorkingDir: string;
    let realRequestedPath: string;
    
    try {
      realWorkingDir = await fs.realpath(workingDirectory);
      const tempPath = resolve(workingDirectory, requestedPath);
      realRequestedPath = await fs.realpath(tempPath);
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        // Path doesn't exist, but we still need to check if it would be inside working dir
        realWorkingDir = await fs.realpath(workingDirectory);
        const tempPath = resolve(workingDirectory, requestedPath);
        const relativePath = relative(realWorkingDir, tempPath);
        if (relativePath.startsWith('..')) {
          return createErrorResponse('Path access denied', 403, { code: 'PATH_ACCESS_DENIED' });
        }
        realRequestedPath = tempPath;
      } else {
        return createErrorResponse('Path access denied', 403, { code: 'PATH_ACCESS_DENIED' });
      }
    }

    // Prevent path traversal attacks using real paths
    const relativePath = relative(realWorkingDir, realRequestedPath);
    if (relativePath.startsWith('..') || !realRequestedPath.startsWith(realWorkingDir + '/') && realRequestedPath !== realWorkingDir) {
      return createErrorResponse('Path access denied', 403, { code: 'PATH_ACCESS_DENIED' });
    }

    // Check if directory exists and is accessible
    try {
      const stats = await fs.stat(realRequestedPath);
      if (!stats.isDirectory()) {
        return createErrorResponse('Path is not a directory', 400, { code: 'NOT_A_DIRECTORY' });
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return createErrorResponse('Directory not found', 404, { code: 'DIRECTORY_NOT_FOUND' });
        }
        if ((error as NodeJS.ErrnoException).code === 'EACCES') {
          return createErrorResponse('Permission denied', 403, { code: 'PERMISSION_DENIED' });
        }
      }
      throw error; // Re-throw unexpected errors
    }

    // Read directory contents
    const dirents = await fs.readdir(realRequestedPath, { withFileTypes: true });
    const entries: SessionFileEntry[] = [];

    for (const dirent of dirents) {
      try {
        const entryPath = join(realRequestedPath, dirent.name);
        
        // Use lstat to detect symlinks without following them
        const entryLstat = await fs.lstat(entryPath);
        
        // Skip symlinks to prevent following them outside working directory
        if (entryLstat.isSymbolicLink()) {
          continue;
        }

        // Check if readable
        await fs.access(entryPath, fsConstants.R_OK);
        
        // For directories, also check execute permission
        if (dirent.isDirectory()) {
          await fs.access(entryPath, fsConstants.X_OK);
        }

        // Calculate relative path from working directory and normalize to POSIX
        const relativeEntryPath = relative(realWorkingDir, entryPath).replace(/\\/g, '/');

        entries.push({
          name: dirent.name,
          path: relativeEntryPath,
          type: dirent.isDirectory() ? 'directory' : 'file',
          size: dirent.isFile() ? entryLstat.size : undefined,
          lastModified: entryLstat.mtime,
          isReadable: true,
        });
      } catch {
        // Skip entries we can't read
        continue;
      }
    }

    // Sort: directories first, then alphabetically (case-insensitive, locale-aware)
    entries.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
    });

    const response: SessionDirectoryResponse = {
      workingDirectory: basename(realWorkingDir),
      currentPath: relativePath.replace(/\\/g, '/'),
      entries,
    };

    return createSuccessResponse(response);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return createErrorResponse(
      'Failed to list directory',
      500,
      { code: 'INTERNAL_SERVER_ERROR', error: err }
    );
  }
}
