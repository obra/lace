// ABOUTME: API endpoint for retrieving file content from a session's working directory
// ABOUTME: Provides secure file reading with MIME type detection, size limits, and path traversal protection

import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import { resolve, relative, extname } from 'path';
import { createSuccessResponse, createErrorResponse } from '@/lib/server/api-utils';
import { SessionService } from '@/lib/server/session-service';
import { asThreadId } from '@/types/core';
import {
  GetSessionFileRequestSchema,
  type SessionFileContentResponse,
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string; path: string[] }> }
) {
  try {
    // Await params before accessing properties
    const { sessionId, path: pathSegments } = await params;
    const filePath = pathSegments.join('/');

    // Validate request
    const { path: requestedPath } = GetSessionFileRequestSchema.parse({ path: filePath });

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

    // Security: Resolve paths and prevent traversal outside working directory
    const absoluteWorkingDir = resolve(workingDirectory);
    const absoluteFilePath = resolve(absoluteWorkingDir, requestedPath);
    const relativePath = relative(absoluteWorkingDir, absoluteFilePath);

    // Prevent path traversal attacks
    if (
      relativePath.startsWith('..') ||
      resolve(absoluteWorkingDir, relativePath) !== absoluteFilePath
    ) {
      return createErrorResponse('Path access denied', 403, { code: 'PATH_ACCESS_DENIED' });
    }

    // Check if file exists and is accessible
    let stats;
    try {
      stats = await fs.stat(absoluteFilePath);
      if (stats.isDirectory()) {
        return createErrorResponse('Path is a directory, not a file', 400, {
          code: 'PATH_IS_DIRECTORY',
        });
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return createErrorResponse('File not found', 404, { code: 'FILE_NOT_FOUND' });
        }
        if ((error as NodeJS.ErrnoException).code === 'EACCES') {
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
        details: { maxSize: MAX_FILE_SIZE, actualSize: stats.size },
      });
    }

    // Determine MIME type and encoding
    const mimeType = getMimeType(absoluteFilePath);
    const isText = isTextFile(mimeType);

    if (!isText) {
      return createErrorResponse('Binary files are not supported', 415, {
        code: 'UNSUPPORTED_FILE_TYPE',
        details: { mimeType },
      });
    }

    // Read file content
    let content: string;
    try {
      await fs.access(absoluteFilePath, fs.constants.R_OK);
      content = await fs.readFile(absoluteFilePath, 'utf8');
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'EACCES'
      ) {
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

    return createSuccessResponse(response);
  } catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to read file',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}
