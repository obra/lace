// ABOUTME: Fast text search tool using ripgrep for codebase analysis
// ABOUTME: Wraps ripgrep command with structured output and error handling

import { exec } from 'child_process';
import { promisify } from 'util';
import {
  ToolCall,
  ToolResult,
  ToolContext,
  createSuccessResult,
} from '../types.js';
import { BaseTool, ValidationError } from '../base-tool.js';

const execAsync = promisify(exec);

interface SearchMatch {
  path: string;
  lineNumber: number;
  content: string;
}

export class RipgrepSearchTool extends BaseTool {
  name = 'ripgrep_search';
  description = 'Fast text search across files using ripgrep';
  annotations = {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  };
  inputSchema = {
    type: 'object' as const,
    properties: {
      pattern: { type: 'string', description: 'Text pattern to search for' },
      path: {
        type: 'string',
        description: 'Directory or file path to search (default: current directory)',
      },
      caseSensitive: { type: 'boolean', description: 'Case sensitive search (default: false)' },
      wholeWord: { type: 'boolean', description: 'Match whole words only (default: false)' },
      includePattern: { type: 'string', description: 'File pattern to include (e.g., "*.ts")' },
      excludePattern: {
        type: 'string',
        description: 'File pattern to exclude (e.g., "*.test.ts")',
      },
      maxResults: { type: 'number', description: 'Maximum number of results (default: 50)' },
      contextLines: { type: 'number', description: 'Lines of context around matches (default: 0)' },
    },
    required: ['pattern'],
  };

  async executeTool(call: ToolCall, _context?: ToolContext): Promise<ToolResult> {
    try {
      const pattern = this.validateNonEmptyStringParam(call.arguments.pattern, 'pattern', call.id);
      const path = this.validateOptionalParam(
        call.arguments.path,
        'path',
        (value) => this.validateNonEmptyStringParam(value, 'path'),
        call.id
      ) ?? '.';
      
      const caseSensitive = this.validateOptionalParam(
        call.arguments.caseSensitive,
        'caseSensitive',
        (value) => this.validateBooleanParam(value, 'caseSensitive'),
        call.id
      ) ?? false;

      const wholeWord = this.validateOptionalParam(
        call.arguments.wholeWord,
        'wholeWord',
        (value) => this.validateBooleanParam(value, 'wholeWord'),
        call.id
      ) ?? false;

      const includePattern = this.validateOptionalParam(
        call.arguments.includePattern,
        'includePattern',
        (value) => this.validateStringParam(value, 'includePattern'),
        call.id
      );

      const excludePattern = this.validateOptionalParam(
        call.arguments.excludePattern,
        'excludePattern',
        (value) => this.validateStringParam(value, 'excludePattern'),
        call.id
      );

      const maxResults = this.validateOptionalParam(
        call.arguments.maxResults,
        'maxResults',
        (value) => this.validateNumberParam(value, 'maxResults', call.id, { min: 1, max: 1000, integer: true }),
        call.id
      ) ?? 50;

      const contextLines = this.validateOptionalParam(
        call.arguments.contextLines,
        'contextLines',
        (value) => this.validateNumberParam(value, 'contextLines', call.id, { min: 0, max: 10, integer: true }),
        call.id
      ) ?? 0;

      const args = this.buildRipgrepArgs({
        pattern,
        path,
        caseSensitive,
        wholeWord,
        includePattern,
        excludePattern,
        maxResults,
        contextLines,
      });

      const command = `rg ${args.join(' ')}`;

      try {
        const { stdout } = await execAsync(command, {
          cwd: process.cwd(),
          maxBuffer: 10485760, // 10MB buffer
        });

        const matches = this.parseRipgrepOutput(stdout, maxResults);
        const resultText = this.formatResults(matches, pattern, maxResults);

        return createSuccessResult(
          [
            {
              type: 'text',
              text: resultText,
            },
          ],
          call.id
        );
      } catch (execError: unknown) {
        // ripgrep exits with code 1 when no matches found
        const err = execError as { code?: number; message?: string };
        if (err.code === 1) {
          return createSuccessResult(
            [
              {
                type: 'text',
                text: `No matches found for pattern: ${pattern}`,
              },
            ],
            call.id
          );
        }

        // Other errors (e.g., invalid regex, file not found)
        throw execError;
      }
    } catch (error) {
      if (error instanceof ValidationError) {
        return error.toolResult;
      }

      if (error instanceof Error) {
        // Check if ripgrep is not installed
        if (error.message.includes('command not found') || error.message.includes('not recognized')) {
          return this.createStructuredError(
            'ripgrep (rg) command not found',
            'Install ripgrep to use this tool: brew install ripgrep (macOS) or apt-get install ripgrep (Linux)',
            'Search tool dependency missing',
            call.id
          );
        }
      }

      return this.createStructuredError(
        'Search operation failed',
        'Check the search pattern and directory path, then try again',
        error instanceof Error ? error.message : 'Unknown error occurred',
        call.id
      );
    }
  }

  private buildRipgrepArgs(options: {
    pattern: string;
    path: string;
    caseSensitive: boolean;
    wholeWord: boolean;
    includePattern?: string;
    excludePattern?: string;
    maxResults: number;
    contextLines: number;
  }): string[] {
    const args = ['--line-number', '--with-filename'];

    if (!options.caseSensitive) {
      args.push('--ignore-case');
    }

    if (options.wholeWord) {
      args.push('--word-regexp');
    }

    if (options.includePattern) {
      args.push('--glob', `"${options.includePattern}"`);
    }

    if (options.excludePattern) {
      args.push('--glob', `!"${options.excludePattern}"`);
    }

    // Note: We don't use --max-count here as it limits per file
    // Instead, we limit total results in parseRipgrepOutput

    if (options.contextLines > 0) {
      args.push('--context', options.contextLines.toString());
    }

    // Add pattern and path (escape quotes in pattern)
    args.push(`"${options.pattern.replace(/"/g, '\\"')}"`);
    args.push(`"${options.path}"`);

    return args;
  }

  private parseRipgrepOutput(output: string, maxResults: number): SearchMatch[] {
    if (!output.trim()) {
      return [];
    }

    const lines = output.trim().split('\n');
    const matches: SearchMatch[] = [];

    for (const line of lines) {
      // ripgrep format: path:lineNumber:content
      const match = line.match(/^([^:]+):(\d+):(.*)$/);
      if (match) {
        matches.push({
          path: match[1],
          lineNumber: parseInt(match[2], 10),
          content: match[3],
        });

        // Limit total results across all files
        if (matches.length >= maxResults) {
          break;
        }
      }
    }

    return matches;
  }

  private formatResults(matches: SearchMatch[], pattern: string, maxResults: number): string {
    if (matches.length === 0) {
      return `No matches found for pattern: ${pattern}`;
    }

    const resultLines = [`Found ${matches.length} match${matches.length === 1 ? '' : 'es'}:\n`];

    // Add truncation message if we hit the limit
    if (matches.length === maxResults) {
      resultLines.push(`Results limited to ${maxResults}. Use maxResults parameter to see more.\n`);
    }

    // Group matches by file
    const fileGroups = new Map<string, SearchMatch[]>();
    for (const match of matches) {
      if (!fileGroups.has(match.path)) {
        fileGroups.set(match.path, []);
      }
      fileGroups.get(match.path)!.push(match);
    }

    for (const [filePath, fileMatches] of fileGroups) {
      resultLines.push(`${filePath}:`);
      for (const match of fileMatches) {
        resultLines.push(`  ${match.lineNumber}: ${match.content}`);
      }
      resultLines.push('');
    }

    return resultLines.join('\n');
  }
}
