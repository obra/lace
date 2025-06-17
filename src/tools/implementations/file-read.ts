// ABOUTME: File reading tool with optional line range support
// ABOUTME: Safe file access for code inspection and analysis

import { readFile } from 'fs/promises';
import { Tool, ToolResult, ToolContext, createSuccessResult, createErrorResult } from '../types.js';

export class FileReadTool implements Tool {
  name = 'file_read';
  description = 'Read file contents with optional line range';
  annotations = {
    title: 'File Reader',
    readOnlyHint: true,
    idempotentHint: true,
  };
  input_schema = {
    type: 'object' as const,
    properties: {
      path: { type: 'string', description: 'File path to read' },
      startLine: { type: 'number', description: 'Starting line number (1-based, optional)' },
      endLine: { type: 'number', description: 'Ending line number (1-based, optional)' },
    },
    required: ['path'],
  };

  async executeTool(input: Record<string, unknown>, _context?: ToolContext): Promise<ToolResult> {
    const { path, startLine, endLine } = input as {
      path: string;
      startLine?: number;
      endLine?: number;
    };

    if (!path || typeof path !== 'string') {
      return createErrorResult('Path must be a non-empty string');
    }

    try {
      const content = await readFile(path, 'utf-8');
      const lines = content.split('\n');

      let resultLines = lines;
      if (startLine !== undefined || endLine !== undefined) {
        const start = Math.max(0, (startLine ?? 1) - 1);
        const end = endLine !== undefined ? Math.min(lines.length, endLine) : lines.length;

        if (start >= lines.length) {
          return createErrorResult(
            `Start line ${startLine} exceeds file length (${lines.length} lines)`
          );
        }

        resultLines = lines.slice(start, end);
      }

      const resultContent = resultLines.join('\n');

      return createSuccessResult([
        {
          type: 'text',
          text: resultContent,
        },
      ]);
    } catch (error) {
      return createErrorResult(error instanceof Error ? error.message : 'Unknown error occurred');
    }
  }
}
