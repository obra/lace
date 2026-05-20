// ABOUTME: Schema-based file writing tool with structured output
// ABOUTME: Safe file creation and modification with Zod validation and enhanced error handling

import { z } from 'zod';
import { dirname } from 'path';
import { Tool } from '../tool';
import { FilePath } from '../schemas/common';
import type { ToolResult, ToolContext, ToolAnnotations } from '../types';
import type { RuntimePath } from '../runtime/types';
import { formatFileSize } from '@lace/agent/tools/utils/format-file-size';

const fileWriteSchema = z.object({
  path: FilePath,
  content: z.string(), // Allow empty content
  createDirs: z.boolean().default(true),
});

function parentRuntimePath(runtimePath: RuntimePath): RuntimePath {
  return {
    original: dirname(runtimePath.original),
    runtimePath: dirname(runtimePath.runtimePath),
    ...(runtimePath.hostPath ? { hostPath: dirname(runtimePath.hostPath) } : {}),
    displayPath: dirname(runtimePath.displayPath),
  };
}

export class FileWriteTool extends Tool {
  name = 'file_write';
  description = `Write content to file, OVERWRITES existing content completely. Use file-insert to preserve content.
Creates parent directories automatically if needed. Returns file size written.`;
  schema = fileWriteSchema;
  annotations: ToolAnnotations = {
    destructiveHint: true,
    readOnlySafe: false,
  };

  protected async executeValidated(
    args: z.infer<typeof fileWriteSchema>,
    context: ToolContext
  ): Promise<ToolResult> {
    if (context.signal.aborted) {
      return this.createCancellationResult();
    }

    if (!context.runtime) {
      return this.createError('Tool context missing runtime. This is a system error.');
    }

    let displayPath = args.path;
    try {
      const { content, createDirs } = args;
      const runtimePath = await context.runtime.paths.resolve(args.path);
      displayPath = runtimePath.displayPath;

      // Check read-before-write protection
      const protectionError = await this.checkRuntimeFileReadProtection(
        displayPath,
        runtimePath,
        context
      );
      if (protectionError) {
        return protectionError;
      }

      // Create parent directories if requested
      if (createDirs) {
        // Check abort before mkdir
        if (context.signal.aborted) {
          return this.createCancellationResult();
        }

        await context.runtime.fs.mkdir(parentRuntimePath(runtimePath), { recursive: true });

        // Check abort after mkdir
        if (context.signal.aborted) {
          return this.createCancellationResult();
        }
      }

      // Write the file
      await context.runtime.fs.writeTextFile(runtimePath, content);

      // Check abort before returning success
      if (context.signal.aborted) {
        return this.createCancellationResult();
      }

      const byteLength = Buffer.byteLength(content, 'utf8');
      const result = this.createResult(
        `Successfully wrote ${formatFileSize(byteLength)} to ${displayPath}`
      );
      result.metadata = { path: displayPath, bytesWritten: byteLength };
      return result;
    } catch (error: unknown) {
      return this.handleFileSystemError(error, displayPath);
    }
  }

  private handleFileSystemError(error: unknown, filePath: string): ToolResult {
    if (error instanceof Error) {
      const nodeError = error as Error & { code?: string };

      switch (nodeError.code) {
        case 'EACCES': {
          const result = this.createError(
            `Permission denied writing to ${filePath}. Check file permissions or choose a different location. File system error: ${error.message}`
          );
          result.metadata = { errorCode: 'EACCES' };
          return result;
        }

        case 'ENOENT': {
          const result = this.createError(
            `Directory does not exist for path ${filePath}. Ensure parent directories exist or set createDirs to true. File system error: ${error.message}`
          );
          result.metadata = { errorCode: 'ENOENT' };
          return result;
        }

        case 'ENOSPC': {
          const result = this.createError(
            `Insufficient disk space to write file. Free up disk space and try again. File system error: ${error.message}`
          );
          result.metadata = { errorCode: 'ENOSPC' };
          return result;
        }

        case 'EISDIR': {
          const result = this.createError(
            `Path ${filePath} is a directory, not a file. Specify a file path instead of a directory path.`
          );
          result.metadata = { errorCode: 'EISDIR' };
          return result;
        }

        case 'EMFILE':
        case 'ENFILE': {
          const result = this.createError(
            `Too many open files. Close some files and try again. File system error: ${error.message}`
          );
          result.metadata = { errorCode: nodeError.code };
          return result;
        }

        default: {
          const result = this.createError(
            `Failed to write file: ${error.message}. Check the file path and permissions, then try again.`
          );
          if (nodeError.code) {
            result.metadata = { errorCode: nodeError.code };
          }
          return result;
        }
      }
    }

    return this.createError(
      `Failed to write file due to unknown error. Check the file path and permissions, then try again.`
    );
  }
}
