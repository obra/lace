// ABOUTME: File reading tool with optional line range support
// ABOUTME: Safe file access for code inspection and analysis

import {
  ToolCall,
  ToolResult,
  ToolContext,
  createSuccessResult,
} from '../types.js';
import { BaseTool, ValidationError } from '../base-tool.js';

export class FileReadTool extends BaseTool {
  name = 'file_read';
  description = 'Read file contents with optional line range';
  annotations = {
    title: 'File Reader',
    readOnlyHint: true,
    idempotentHint: true,
  };
  inputSchema = {
    type: 'object' as const,
    properties: {
      path: { type: 'string', description: 'File path to read' },
      startLine: { type: 'number', description: 'Starting line number (1-based, optional)' },
      endLine: { type: 'number', description: 'Ending line number (1-based, optional)' },
    },
    required: ['path'],
  };

  async executeTool(call: ToolCall, _context?: ToolContext): Promise<ToolResult> {
    try {
      const path = this.validateNonEmptyStringParam(call.arguments.path, 'path', call.id);
      const startLine = this.validateOptionalParam(
        call.arguments.startLine,
        'startLine',
        (value) => this.validateNumberParam(value, 'startLine', call.id, { min: 1, integer: true }),
        call.id
      );
      const endLine = this.validateOptionalParam(
        call.arguments.endLine,
        'endLine',
        (value) => this.validateNumberParam(value, 'endLine', call.id, { min: 1, integer: true }),
        call.id
      );

      // Validate startLine <= endLine if both are provided
      if (startLine !== undefined && endLine !== undefined && startLine > endLine) {
        return this.createStructuredError(
          `Start line ${startLine} is greater than end line ${endLine}`,
          'Ensure startLine <= endLine',
          'Invalid line range specified',
          call.id
        );
      }

      // Read file and split into lines
      const content = await this.readFileWithContext(path, call.id);
      const lines = content.split('\n');

      let resultLines = lines;
      if (startLine !== undefined || endLine !== undefined) {
        const start = Math.max(0, (startLine ?? 1) - 1);
        const end = endLine !== undefined ? Math.min(lines.length, endLine) : lines.length;

        // Validate line numbers against file content
        if (startLine !== undefined) {
          this.validateLineNumber(startLine, content, 'startLine', call.id);
        }
        if (endLine !== undefined) {
          this.validateLineNumber(endLine, content, 'endLine', call.id);
        }

        resultLines = lines.slice(start, end);
      }

      const resultContent = resultLines.join('\n');
      const totalLines = this.countLines(content);
      const metadata = {
        totalLines,
        linesReturned: resultLines.length,
        fileSize: this.formatFileSize(content.length),
      };

      return this.createSuccessWithMetadata(
        [
          {
            type: 'text',
            text: resultContent,
          },
        ],
        metadata,
        call.id
      );
    } catch (error) {
      if (error instanceof ValidationError) {
        return error.toolResult;
      }

      return this.createStructuredError(
        'File reading failed',
        'Check the file path and line numbers, then try again',
        error instanceof Error ? error.message : 'Unknown error occurred',
        call.id
      );
    }
  }
}
