// ABOUTME: Read file content tool - focused, single-purpose file reading with line range support
// ABOUTME: Handles reading full files or specific line ranges for large files

import { BaseTool, ToolSchema, ToolContext } from './base-tool.js';
import { promises as fs } from 'fs';
import { stat } from 'fs/promises';

export interface ReadFileParams {
  path: string;
  offset?: number;
  limit?: number;
}

export interface ReadFileResult {
  content: string;
  size: number;
  path: string;
  lines_read?: number;
  offset_used?: number;
}

export class ReadFileTool extends BaseTool {
  getMetadata(): ToolSchema {
    return {
      name: 'read_file',
      description: 'Read the contents of a file',
      methods: {
        run: {
          description: 'Read file content as text, optionally with line range',
          parameters: {
            path: {
              type: 'string',
              required: true,
              description: 'Path to the file to read'
            },
            offset: {
              type: 'number',
              required: false,
              description: 'Line number to start reading from (1-based)'
            },
            limit: {
              type: 'number',
              required: false,
              description: 'Maximum number of lines to read'
            }
          }
        }
      }
    };
  }

  async run(params: ReadFileParams, context?: ToolContext): Promise<ReadFileResult> {
    const { path, offset, limit } = params;

    try {
      // Check if file exists and get stats
      const stats = await stat(path);
      
      if (!stats.isFile()) {
        throw new Error(`Path '${path}' is not a file`);
      }

      // Check for cancellation before reading
      if (context?.signal?.aborted) {
        throw new Error('Operation was cancelled');
      }

      // Read file content
      const fullContent = await fs.readFile(path, 'utf8');
      
      // If no offset/limit specified, return full content
      if (offset === undefined && limit === undefined) {
        return {
          content: fullContent,
          size: stats.size,
          path
        };
      }

      // Split into lines for range reading
      const lines = fullContent.split('\n');
      const startLine = offset ? Math.max(0, offset - 1) : 0; // Convert to 0-based
      const endLine = limit ? startLine + limit : lines.length;
      
      const selectedLines = lines.slice(startLine, endLine);
      const content = selectedLines.join('\n');

      return {
        content,
        size: stats.size,
        path,
        lines_read: selectedLines.length,
        offset_used: startLine + 1 // Convert back to 1-based for response
      };

    } catch (error) {
      if (error instanceof Error) {
        if ((error as any).code === 'ENOENT') {
          throw new Error(`File not found: ${path}`);
        }
        if ((error as any).code === 'EACCES') {
          throw new Error(`Permission denied: ${path}`);
        }
        if ((error as any).code === 'EISDIR') {
          throw new Error(`Path is a directory, not a file: ${path}`);
        }
      }
      throw error;
    }
  }
}