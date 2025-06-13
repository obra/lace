// ABOUTME: Write file content tool - focused, single-purpose file writing
// ABOUTME: Handles writing text content to files with directory creation

import { BaseTool, ToolSchema, ToolContext } from './base-tool.js';
import { promises as fs } from 'fs';
import { dirname } from 'path';

export interface WriteFileParams {
  path: string;
  content: string;
}

export interface WriteFileResult {
  path: string;
  bytes_written: number;
  created_directories?: boolean;
}

export class WriteFileTool extends BaseTool {
  getMetadata(): ToolSchema {
    return {
      name: 'write_file',
      description: 'Write content to a file',
      methods: {
        run: {
          description: 'Write text content to a file, creating directories if needed',
          parameters: {
            path: {
              type: 'string',
              required: true,
              description: 'Path to the file to write'
            },
            content: {
              type: 'string',
              required: true,
              description: 'Content to write to the file'
            }
          }
        }
      }
    };
  }

  async run(params: WriteFileParams, context?: ToolContext): Promise<WriteFileResult> {
    const { path, content } = params;

    try {
      // Check for cancellation before writing
      if (context?.signal?.aborted) {
        throw new Error('Operation was cancelled');
      }

      // Ensure parent directory exists
      const parentDir = dirname(path);
      let createdDirectories = false;
      
      try {
        await fs.access(parentDir);
      } catch (error) {
        // Directory doesn't exist, create it
        await fs.mkdir(parentDir, { recursive: true });
        createdDirectories = true;
      }

      // Write the file
      await fs.writeFile(path, content, 'utf8');
      
      // Get the bytes written
      const bytesWritten = Buffer.byteLength(content, 'utf8');

      const result: WriteFileResult = {
        path,
        bytes_written: bytesWritten
      };

      if (createdDirectories) {
        result.created_directories = true;
      }

      return result;

    } catch (error) {
      if (error instanceof Error) {
        if ((error as any).code === 'EACCES') {
          throw new Error(`Permission denied: ${path}`);
        }
        if ((error as any).code === 'ENOTDIR') {
          throw new Error(`Parent path is not a directory: ${dirname(path)}`);
        }
        if ((error as any).code === 'ENOSPC') {
          throw new Error(`No space left on device: ${path}`);
        }
      }
      throw error;
    }
  }
}