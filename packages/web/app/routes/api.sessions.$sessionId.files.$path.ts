// ABOUTME: API endpoint for retrieving file content from a session's working directory
// ABOUTME: Provides secure file reading with MIME type detection, size limits, and path traversal protection

// import type { Route } from './+types/api.sessions.$sessionId.files.$path';

// Define the route args manually since splat types may not generate correctly
interface LoaderArgs {
  request: Request;
  params: {
    sessionId: string;
    '*'?: string;
  };
  context?: unknown;
}
import { promises as fs, constants as fsConstants } from 'fs';
import { resolve, relative } from 'path';
import mime from 'mime-types';
import { createSuccessResponse, createErrorResponse } from '@/lib/server/api-utils';
import { logger } from '~/utils/logger';
import { SessionService } from '@/lib/server/session-service';
import { asThreadId } from '@/types/core';
import {
  GetSessionFileRequestSchema,
  type SessionFileContentResponse,
} from '@/types/session-files';

// File size limits as constants
export const MAX_FILE_SIZE = 1024 * 1024; // 1MB

// MIME type detection using mime-types library
function getMimeType(filePath: string): string {
  return mime.lookup(filePath) || 'text/plain';
}

// Check if file is likely text-based
function isTextFile(mimeType: string): boolean {
  return mimeType.startsWith('text/') || 
         mimeType === 'application/json' ||
         mimeType === 'application/javascript' ||
         mimeType === 'video/mp2t'; // .ts files incorrectly detected as MPEG transport stream
}

export async function loader({ request: _request, params }: LoaderArgs) {
  try {
    const { sessionId } = params;
    const splatPath = (params as Record<string, string>)['*'] || (params as Record<string, string>)['path'] || '';
    const filePath = splatPath;

    // Validate request
    const parseResult = GetSessionFileRequestSchema.safeParse({ path: filePath });
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
    let realFilePath: string;
    
    try {
      realWorkingDir = await fs.realpath(workingDirectory);
      const tempFilePath = resolve(workingDirectory, requestedPath);
      realFilePath = await fs.realpath(tempFilePath);
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        // File doesn't exist, but we still need to check if it would be inside working dir
        realWorkingDir = await fs.realpath(workingDirectory);
        const tempFilePath = resolve(workingDirectory, requestedPath);
        const relativePath = relative(realWorkingDir, tempFilePath);
        if (relativePath.startsWith('..')) {
          return createErrorResponse('Path access denied', 403, { code: 'PATH_ACCESS_DENIED' });
        }
        realFilePath = tempFilePath;
      } else {
        return createErrorResponse('Path access denied', 403, { code: 'PATH_ACCESS_DENIED' });
      }
    }

    // Prevent path traversal attacks using real paths
    const relativePath = relative(realWorkingDir, realFilePath);
    if (relativePath.startsWith('..') || !realFilePath.startsWith(realWorkingDir + '/') && realFilePath !== realWorkingDir) {
      return createErrorResponse('Path access denied', 403, { code: 'PATH_ACCESS_DENIED' });
    }

    // Check if file exists and is accessible using lstat to avoid following symlinks
    let stats;
    try {
      stats = await fs.lstat(realFilePath);
      if (stats.isDirectory()) {
        return createErrorResponse('Path is a directory, not a file', 400, {
          code: 'PATH_IS_DIRECTORY',
        });
      }
      if (stats.isSymbolicLink()) {
        return createErrorResponse('Symbolic links are not supported', 403, {
          code: 'SYMLINK_NOT_SUPPORTED',
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

    // Check file size - limit using shared constant
    if (stats.size > MAX_FILE_SIZE) {
      return createErrorResponse('File too large to display', 413, {
        code: 'FILE_TOO_LARGE',
        details: { maxSize: MAX_FILE_SIZE, actualSize: stats.size },
      });
    }

    // Determine MIME type and encoding
    const mimeType = getMimeType(realFilePath);
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
      await fs.access(realFilePath, fsConstants.R_OK);
      content = await fs.readFile(realFilePath, 'utf8');
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
      path: relativePath.replace(/\\/g, '/'),
      content,
      mimeType,
      encoding: 'utf8',
      size: stats.size,
    };

    return createSuccessResponse(response);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('File content route error:', { message: err.message, stack: err.stack });
    return createErrorResponse(
      'Failed to read file',
      500,
      { code: 'INTERNAL_SERVER_ERROR', error: { message: err.message, stack: err.stack } }
    );
  }
}
