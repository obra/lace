// ABOUTME: REST API endpoint for listing directories with home directory security
// ABOUTME: Returns directory contents with permissions and metadata for file browser component

import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import { join, resolve, relative } from 'path';
import { homedir } from 'os';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import { ListDirectoryRequestSchema } from '@/types/filesystem';
import type { DirectoryEntry, ListDirectoryResponse } from '@/types/filesystem';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const rawPath = searchParams.get('path') || homedir();

    // Validate input
    const { path } = ListDirectoryRequestSchema.parse({ path: rawPath });

    // Security: Ensure path is within user's home directory
    const homeDir = homedir();
    const absolutePath = resolve(path);
    const relativePath = relative(homeDir, absolutePath);

    if (relativePath.startsWith('..') || resolve(homeDir, relativePath) !== absolutePath) {
      return createErrorResponse('Access denied: path outside home directory', 403, {
        code: 'PATH_ACCESS_DENIED',
      });
    }

    // Check if directory exists and is accessible
    const stats = await fs.stat(absolutePath);
    if (!stats.isDirectory()) {
      return createErrorResponse('Path is not a directory', 400, {
        code: 'NOT_A_DIRECTORY',
      });
    }

    // List directory contents
    const dirents = await fs.readdir(absolutePath, { withFileTypes: true });
    const entries: DirectoryEntry[] = [];

    for (const dirent of dirents) {
      try {
        const entryPath = join(absolutePath, dirent.name);
        const entryStats = await fs.stat(entryPath);

        // Check read permissions
        await fs.access(entryPath, fs.constants.R_OK);
        const canRead = true;

        // Check write permissions
        let canWrite = false;
        try {
          await fs.access(entryPath, fs.constants.W_OK);
          canWrite = true;
        } catch {
          canWrite = false;
        }

        // Determine type: treat symlinks to directories as directories
        let entryType: 'directory' | 'file';
        if (dirent.isDirectory()) {
          entryType = 'directory';
        } else if (dirent.isSymbolicLink()) {
          // For symlinks, check if they point to a directory
          entryType = entryStats.isDirectory() ? 'directory' : 'file';
        } else {
          entryType = 'file';
        }

        entries.push({
          name: dirent.name,
          path: entryPath,
          type: entryType,
          lastModified: entryStats.mtime,
          permissions: {
            canRead,
            canWrite,
          },
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

    // Build breadcrumb information
    const breadcrumbPaths: string[] = [];
    const breadcrumbNames: string[] = [];

    if (absolutePath === homeDir) {
      breadcrumbPaths.push(homeDir);
      breadcrumbNames.push('Home');
    } else {
      // Build path from home to current directory
      const relativePathForBreadcrumbs = relative(homeDir, absolutePath);
      const pathParts = relativePathForBreadcrumbs.split('/').filter(Boolean);

      breadcrumbPaths.push(homeDir);
      breadcrumbNames.push('Home');

      let currentBreadcrumbPath = homeDir;
      for (const part of pathParts) {
        currentBreadcrumbPath = join(currentBreadcrumbPath, part);
        breadcrumbPaths.push(currentBreadcrumbPath);
        breadcrumbNames.push(part);
      }
    }

    const response: ListDirectoryResponse = {
      currentPath: absolutePath,
      parentPath: absolutePath === homeDir ? null : resolve(absolutePath, '..'),
      entries: entries.filter((entry) => entry.type === 'directory'), // Only directories
      breadcrumbPaths,
      breadcrumbNames,
      homeDirectory: homeDir,
    };

    return createSuperjsonResponse(response);
  } catch (error) {
    if (error instanceof Error) {
      const fsError = error as NodeJS.ErrnoException;
      if (fsError.code === 'ENOENT') {
        return createErrorResponse('Directory not found', 404, {
          code: 'DIRECTORY_NOT_FOUND',
        });
      }

      if (fsError.code === 'EACCES') {
        return createErrorResponse('Permission denied', 403, {
          code: 'PERMISSION_DENIED',
        });
      }
    }

    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to list directory',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}
