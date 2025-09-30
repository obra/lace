// ABOUTME: REST API endpoint for creating directories with validation
// ABOUTME: Enforces home directory security boundary and validates directory names

import { promises as fs } from 'fs';
import { join, resolve, sep } from 'path';
import { homedir } from 'os';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import { CreateDirectoryRequestSchema } from '@/types/filesystem';
import type { CreateDirectoryResponse } from '@/types/filesystem';
import type { Route } from './+types/api.filesystem.mkdir';

export async function action({ request }: Route.ActionArgs) {
  try {
    const body = (await request.json()) as unknown;
    const { parentPath, name } = CreateDirectoryRequestSchema.parse(body);

    // Security: Ensure parent path is within user's home directory
    const homeDir = homedir();
    const absoluteParent = resolve(parentPath);
    const [realHomeDir, realParentPath] = await Promise.all([
      fs.realpath(homeDir).catch(() => homeDir),
      fs.realpath(absoluteParent).catch(() => absoluteParent),
    ]);

    const isInsideHome =
      realParentPath === realHomeDir ||
      (realParentPath.startsWith(realHomeDir) &&
        (realParentPath[realHomeDir.length] === sep ||
          realHomeDir.endsWith(sep) ||
          realHomeDir === sep));

    if (!isInsideHome) {
      return createErrorResponse('Access denied: path outside home directory', 403, {
        code: 'PATH_ACCESS_DENIED',
      });
    }

    // Verify parent exists and is a directory
    const parentStats = await fs.stat(absoluteParent);
    if (!parentStats.isDirectory()) {
      return createErrorResponse('Parent path is not a directory', 400, {
        code: 'NOT_A_DIRECTORY',
      });
    }

    // Create directory
    const newDirPath = join(absoluteParent, name);
    await fs.mkdir(newDirPath, { recursive: false });

    // Re-verify created directory is inside home (mitigate TOCTOU)
    const realNewDirPath = await fs.realpath(newDirPath);
    const newDirInsideHome =
      realNewDirPath === realHomeDir ||
      (realNewDirPath.startsWith(realHomeDir) &&
        (realNewDirPath[realHomeDir.length] === sep ||
          realHomeDir.endsWith(sep) ||
          realHomeDir === sep));

    if (!newDirInsideHome) {
      // Created directory ended up outside home - delete it and fail
      await fs.rmdir(newDirPath).catch(() => {
        /* ignore cleanup errors */
      });
      return createErrorResponse('Security violation: created directory outside home', 403, {
        code: 'SECURITY_VIOLATION',
      });
    }

    const response: CreateDirectoryResponse = {
      path: newDirPath,
      name,
      success: true,
    };

    return createSuperjsonResponse(response, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      const fsError = error as NodeJS.ErrnoException;

      if (fsError.code === 'EEXIST') {
        return createErrorResponse('Directory already exists', 409, {
          code: 'DIRECTORY_EXISTS',
        });
      }

      if (fsError.code === 'ENOENT') {
        return createErrorResponse('Parent directory not found', 404, {
          code: 'PARENT_NOT_FOUND',
        });
      }

      if (fsError.code === 'EACCES') {
        return createErrorResponse('Permission denied', 403, {
          code: 'PERMISSION_DENIED',
        });
      }
    }

    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to create directory',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}
