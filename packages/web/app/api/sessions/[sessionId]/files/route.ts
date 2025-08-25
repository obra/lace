// ABOUTME: API endpoint for listing files in a session's working directory
// ABOUTME: Provides session-scoped file browsing with path traversal protection and proper error handling

import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import { join, resolve, relative } from 'path';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import { SessionService } from '@/lib/server/session-service';
import { asThreadId } from '@/types/core';
import {
  ListSessionDirectoryRequestSchema,
  type SessionDirectoryResponse,
  type SessionFileEntry,
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

    const workingDirectory = session.getWorkingDirectory();

    if (!workingDirectory) {
      return createErrorResponse('Session has no working directory configured', 400, {
        code: 'NO_WORKING_DIRECTORY',
      });
    }

    // Security: Resolve paths and prevent traversal outside working directory
    const absoluteWorkingDir = resolve(workingDirectory);
    const absoluteRequestedPath = resolve(absoluteWorkingDir, requestedPath);
    const relativePath = relative(absoluteWorkingDir, absoluteRequestedPath);

    // Prevent path traversal attacks
    if (
      relativePath.startsWith('..') ||
      resolve(absoluteWorkingDir, relativePath) !== absoluteRequestedPath
    ) {
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
