// ABOUTME: Schema-based fast text search tool using ripgrep for codebase analysis
// ABOUTME: Wraps ripgrep command with Zod validation and structured output

import { z } from 'zod';
import * as childProcess from 'child_process';
import { promisify } from 'util';
import { Tool } from '~/tools/tool';
import { NonEmptyString, FilePath } from '~/tools/schemas/common';
import type { ToolResult, ToolContext, ToolAnnotations } from '~/tools/types';
import { TOOL_LIMITS } from '~/tools/constants';

// Create promisified version of execFile for async/await usage
const execFileAsync = promisify(childProcess.execFile);

interface SearchMatch {
  path: string;
  lineNumber: number;
  content: string;
}

const ripgrepSearchSchema = z.object({
  pattern: NonEmptyString,
  path: FilePath.default('.'),
  caseSensitive: z.boolean().default(false),
  wholeWord: z.boolean().default(false),
  includePattern: z.string().optional(),
  excludePattern: z.string().optional(),
  maxResults: z
    .number()
    .int('Must be an integer')
    .min(TOOL_LIMITS.MIN_SEARCH_RESULTS, `Must be at least ${TOOL_LIMITS.MIN_SEARCH_RESULTS}`)
    .max(TOOL_LIMITS.MAX_SEARCH_RESULTS, `Must be at most ${TOOL_LIMITS.MAX_SEARCH_RESULTS}`)
    .default(TOOL_LIMITS.DEFAULT_SEARCH_RESULTS),
  contextLines: z
    .number()
    .int('Must be an integer')
    .min(0, 'Cannot be negative')
    .max(10, 'Cannot exceed 10 lines of context')
    .default(0),
});

export class RipgrepSearchTool extends Tool {
  name = 'ripgrep_search';
  description = `Search file contents using regex patterns. Use for text search, file-find for name patterns.
Supports glob filters (includePattern/excludePattern). Returns path:line:content format.`;
  schema = ripgrepSearchSchema;
  annotations: ToolAnnotations = {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  };

  protected async executeValidated(
    args: z.infer<typeof ripgrepSearchSchema>,
    context?: ToolContext
  ): Promise<ToolResult> {
    try {
      const {
        pattern,
        path,
        caseSensitive,
        wholeWord,
        includePattern,
        excludePattern,
        maxResults,
        contextLines,
      } = args;

      // Resolve path using working directory from context
      const resolvedPath = this.resolvePath(path, context);

      const ripgrepArgs = this.buildRipgrepArgs({
        pattern,
        path: resolvedPath,
        caseSensitive,
        wholeWord,
        includePattern,
        excludePattern,
        maxResults,
        contextLines,
      });

      try {
        // Use execFile to prevent shell injection - pass arguments directly
        const { stdout } = await execFileAsync('rg', ripgrepArgs, {
          cwd: process.cwd(),
          maxBuffer: 10485760, // 10MB buffer
        });

        const matches = this.parseRipgrepOutput(stdout, maxResults);
        const resultText = this.formatResults(matches, pattern, maxResults);

        return this.createResult(resultText);
      } catch (execError: unknown) {
        // ripgrep exits with code 1 when no matches found
        const err = execError as { code?: number; message?: string };
        if (err.code === 1) {
          return this.createResult(`No matches found for pattern: ${pattern}`);
        }

        // Other errors (e.g., invalid regex, file not found)
        throw execError;
      }
    } catch (error: unknown) {
      if (error instanceof Error) {
        // Check if ripgrep is not installed
        if (
          error.message.includes('command not found') ||
          error.message.includes('not recognized')
        ) {
          return this.createError(
            'ripgrep (rg) command not found. Install ripgrep to use this tool: brew install ripgrep (macOS) or apt-get install ripgrep (Linux). Search tool dependency missing.'
          );
        }
      }

      return this.createError(
        `Search operation failed: ${error instanceof Error ? error.message : 'Unknown error occurred'}. Check the search pattern and directory path, then try again.`
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
      args.push('--glob', options.includePattern);
    }

    if (options.excludePattern) {
      args.push('--glob', `!${options.excludePattern}`);
    }

    // Note: We don't use --max-count here as it limits per file
    // Instead, we limit total results in parseRipgrepOutput

    if (options.contextLines > 0) {
      args.push('--context', options.contextLines.toString());
    }

    // Add pattern and path (no quotes needed with execFile)
    args.push(options.pattern);
    args.push(options.path);

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
