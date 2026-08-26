// ABOUTME: Schema-based file finding tool with structured output
// ABOUTME: Recursively searches for files using glob patterns with Zod validation

import { z } from 'zod';
import { join } from 'path';
import { Tool } from '../tool';
import { NonEmptyString, FilePath } from '../schemas/common';
import type { ToolResult, ToolContext, ToolAnnotations } from '../types';
import type { RuntimePath, ToolRuntime } from '../runtime/types';
import { formatFileSize } from '@lace/agent/tools/utils/format-file-size';

const MIN_DEPTH = 1;
const MAX_DEPTH = 20;
const DEFAULT_DEPTH = 10;

const MIN_RESULTS = 1;
const MAX_RESULTS = 1000;
// PRI-2975: every runtime.fs call is a process spawn on container runtimes, so a
// large tree can take tens of minutes. The agent loop awaits tool results, so an
// unbounded walk takes the whole session offline. Bound it and return what we
// have. Wall-clock rather than an operation count, because the per-operation
// cost differs by four orders of magnitude between host and container runtimes.
const SEARCH_BUDGET_MS = 30_000;

/**
 * Patterns where our matcher and `find -iname` provably agree, so the traversal
 * can be pushed into a single `find`.
 *
 * matchesPattern ESCAPES `[`, `]` and `\\` and gives meaning only to `*` and
 * `?`; `find -iname` treats brackets as a character class and backslash as an
 * escape. For `a\\*b` that makes -iname strictly NARROWER, which would silently
 * drop matches. Restricting the fast path to characters both engines read the
 * same way keeps it exact; anything else falls back to the walk.
 */
const FIND_SAFE_PATTERN = /^[A-Za-z0-9._\-*?]+$/;
const DEFAULT_RESULTS = 50;

type FileMatch = {
  path: RuntimePath;
  size: number;
  mtime: Date;
  isDirectory: boolean;
};

const fileFindSchema = z.object({
  pattern: NonEmptyString,
  path: FilePath.default('.'),
  maxDepth: z
    .number()
    .int('Must be an integer')
    .min(MIN_DEPTH, `Must be at least ${MIN_DEPTH}`)
    .max(MAX_DEPTH, `Must be at most ${MAX_DEPTH}`)
    .default(DEFAULT_DEPTH),
  includeHidden: z.boolean().default(false),
  maxResults: z
    .number()
    .int('Must be an integer')
    .min(MIN_RESULTS, `Must be at least ${MIN_RESULTS}`)
    .max(MAX_RESULTS, `Must be at most ${MAX_RESULTS}`)
    .default(DEFAULT_RESULTS),
});

export class FileFindTool extends Tool {
  name = 'file_find';
  description = `Find files and directories by name pattern using glob syntax (* and ?). Case-insensitive. Results sorted by modification time (newest first) with sizes and timestamps.`;
  schema = fileFindSchema;
  annotations: ToolAnnotations = {
    readOnlyHint: true,
    idempotentHint: true,
    readOnlySafe: true,
  };

  protected async executeValidated(
    args: z.infer<typeof fileFindSchema>,
    context: ToolContext
  ): Promise<ToolResult> {
    if (context.signal.aborted) {
      return this.createCancellationResult();
    }
    if (!context.runtime) {
      return this.createError('Tool context missing runtime. This is a system error.');
    }

    try {
      const { pattern, maxDepth, includeHidden, maxResults } = args;
      const rootPath = await context.runtime.paths.resolve(args.path);

      // Validate directory exists
      try {
        const pathStat = await context.runtime.fs.stat(rootPath);
        if (pathStat.type !== 'directory') {
          return this.createError(
            `Path ${args.path} is not a directory. Specify a directory path to search in.`
          );
        }
      } catch (error: unknown) {
        if (error instanceof Error && (error as Error & { code?: string }).code === 'ENOENT') {
          return this.createError(
            `Directory not found: ${args.path}. Ensure the directory exists before searching.`
          );
        }
        throw error;
      }

      const budget = { deadline: Date.now() + this.budgetMs(), exhausted: false };

      const fast = await this.fastFind(
        context.runtime,
        rootPath,
        { pattern, maxDepth, includeHidden, budget },
        context.signal
      );

      const matches =
        fast ??
        (await this.findFiles(
          context.runtime,
          rootPath,
          {
            pattern,
            maxDepth,
            includeHidden,
            maxResults,
            currentDepth: 0,
            budget,
          },
          context.signal
        ));

      // Sort by modification time (newest first)
      matches.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      const limitedMatches = matches.slice(0, maxResults);
      const resultLines: string[] = [];

      if (limitedMatches.length > 0) {
        resultLines.push(...limitedMatches.map((match) => this.formatFileEntry(match)));

        // Add truncation message if we hit the limit
        if (matches.length > maxResults) {
          resultLines.push(
            `\nResults limited to ${maxResults}. Use maxResults parameter to see more.`
          );
        }
      } else {
        resultLines.push(`No files found matching pattern: ${pattern}`);
      }

      // Say so loudly: a partial result presented as complete is worse than a
      // slow one, because the model will conclude the file does not exist.
      if (budget.exhausted) {
        resultLines.push(
          `\nSearch stopped early after ${Math.round(this.budgetMs() / 1000)}s; these results are incomplete. Narrow the search with a more specific path or pattern, or raise maxDepth only where needed.`
        );
      }

      return this.createResult(resultLines.join('\n'));
    } catch (error: unknown) {
      // Handle cancellation
      if (error instanceof Error && error.message === 'Aborted') {
        return this.createCancellationResult();
      }
      return this.handleFileSystemError(error, args.path);
    }
  }

  /** Wall-clock ceiling for one search. Overridable so tests can force the cap. */
  protected budgetMs(): number {
    return SEARCH_BUDGET_MS;
  }

  private async findFiles(
    runtime: ToolRuntime,
    dirPath: RuntimePath,
    options: {
      pattern: string;
      maxDepth: number;
      budget: { deadline: number; exhausted: boolean };
      includeHidden: boolean;
      maxResults: number;
      currentDepth: number;
    },
    signal?: AbortSignal
  ): Promise<FileMatch[]> {
    // Check for abort signal
    if (signal?.aborted) {
      throw new Error('Aborted');
    }

    const matches: FileMatch[] = [];

    if (options.currentDepth > options.maxDepth) {
      return matches;
    }

    if (Date.now() >= options.budget.deadline) {
      options.budget.exhausted = true;
      return matches;
    }

    try {
      const items = await runtime.fs.readdir(dirPath);

      for (const item of items) {
        // Check abort signal periodically during loop
        if (signal?.aborted) {
          throw new Error('Aborted');
        }
        if (Date.now() >= options.budget.deadline) {
          options.budget.exhausted = true;
          return matches;
        }
        if (!options.includeHidden && item.name.startsWith('.')) {
          continue;
        }

        const childPath = this.childPath(dirPath, item.name);

        try {
          // readdir already reported the type. Re-deriving it with stat costs a
          // whole container exec per entry on container-backed runtimes, which
          // is what wedged ada-sen for 96 minutes on a node_modules tree
          // (PRI-2975). Note this reports a symlink as a file rather than
          // following it: deliberate, since the walk keeps no visited-set and
          // following directory symlinks can cycle.
          const isDirectory = item.type === 'directory';

          // Case-insensitive pattern matching
          if (this.matchesPattern(item.name, options.pattern)) {
            // stat only for entries we actually return — size and mtime are
            // reported in the results and are needed nowhere else.
            const stats = await runtime.fs.stat(childPath);
            matches.push({
              path: childPath,
              size: stats.size,
              mtime: stats.mtime,
              isDirectory,
            });

            // Early termination: collect more than maxResults to detect truncation later
            if (matches.length > options.maxResults) {
              return matches;
            }
          }

          // Recurse into directories
          if (isDirectory && options.currentDepth < options.maxDepth) {
            const subMatches = await this.findFiles(
              runtime,
              childPath,
              {
                ...options,
                currentDepth: options.currentDepth + 1,
              },
              signal
            );
            matches.push(...subMatches);

            // Early termination: collect more than maxResults to detect truncation later
            if (matches.length > options.maxResults) {
              return matches;
            }
          }
        } catch {
          // Skip items we can't stat (permission issues, broken symlinks, etc.)
          continue;
        }
      }
    } catch {
      // Skip directories we can't read
    }

    return matches;
  }

  /**
   * Whole-tree search in ONE exec.
   *
   * ripgrep_search already delegates traversal to a single in-container
   * process; file_find walking directory-by-directory over runtime.fs was the
   * outlier, and on container runtimes each of those calls is a process spawn
   * (PRI-2975). Returns null when the fast path does not apply, and the caller
   * falls back to the walk.
   */
  private async fastFind(
    runtime: ToolRuntime,
    rootPath: RuntimePath,
    options: {
      pattern: string;
      maxDepth: number;
      includeHidden: boolean;
      budget: { deadline: number; exhausted: boolean };
    },
    signal?: AbortSignal
  ): Promise<FileMatch[] | null> {
    if (!FIND_SAFE_PATTERN.test(options.pattern)) return null;
    // Out of budget before we start: let the walk report the exhaustion.
    if (Date.now() >= options.budget.deadline) return null;

    const root = rootPath.runtimePath;

    // find itself can run long on a huge tree, so it gets the same ceiling as
    // the walk. Abort is distinguished from failure below: a timeout means
    // "incomplete", not "fall back to something slower".
    const deadlineController = new AbortController();
    const remaining = options.budget.deadline - Date.now();
    const timer = setTimeout(() => deadlineController.abort(), remaining);
    const onOuterAbort = () => deadlineController.abort();
    signal?.addEventListener('abort', onOuterAbort, { once: true });

    let result: { exitCode: number; stdout: string };
    try {
      result = await runtime.process.exec(
        [
          'find',
          root,
          '-mindepth',
          '1',
          // maxDepth counts recursion steps, not path depth: the walk's
          // maxDepth 1 still lists entries one directory down.
          '-maxdepth',
          String(options.maxDepth + 1),
          '-iname',
          options.pattern,
          '-printf',
          '%y\\t%s\\t%T@\\t%p\\0',
        ],
        { cwd: runtime.cwd, signal: deadlineController.signal }
      );
    } catch {
      // Our own deadline fired: report incomplete rather than retrying slower.
      if (deadlineController.signal.aborted && !signal?.aborted) {
        options.budget.exhausted = true;
        return [];
      }
      return null;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onOuterAbort);
    }
    if (result.exitCode !== 0) {
      if (deadlineController.signal.aborted && !signal?.aborted) {
        options.budget.exhausted = true;
        return [];
      }
      return null;
    }

    const matches: FileMatch[] = [];
    for (const record of result.stdout.split('\0')) {
      if (!record) continue;
      const parts = record.split('\t');
      if (parts.length < 4) continue;
      const [type, size, mtime] = parts;
      // %p may itself contain tabs; rejoin everything after the third field.
      const absolute = parts.slice(3).join('\t');

      const relative = absolute.startsWith(root) ? absolute.slice(root.length) : absolute;
      const segments = relative.split('/').filter((seg) => seg.length > 0);
      if (segments.length === 0) continue;

      // The walk skips hidden entries and never descends into them, so a hidden
      // component anywhere in the relative path excludes the entry.
      if (!options.includeHidden && segments.some((seg) => seg.startsWith('.'))) continue;

      const name = segments[segments.length - 1] ?? '';
      // -iname is only a prefilter; our matcher stays authoritative.
      if (!this.matchesPattern(name, options.pattern)) continue;

      matches.push({
        path: segments.reduce<RuntimePath>((acc, seg) => this.childPath(acc, seg), rootPath),
        size: Number(size),
        mtime: new Date(Number(mtime) * 1000),
        // %y reports the link itself; a symlink counts as a file, matching the
        // walk's behaviour since PRI-2975.
        isDirectory: type === 'd',
      });
    }
    return matches;
  }

  private childPath(parent: RuntimePath, name: string): RuntimePath {
    return {
      original: join(parent.original, name),
      runtimePath: join(parent.runtimePath, name),
      hostPath: parent.hostPath ? join(parent.hostPath, name) : undefined,
      displayPath: join(parent.displayPath, name),
    };
  }

  private formatFileEntry(entry: FileMatch): string {
    const sizeStr = formatFileSize(entry.size);
    const timeStr = this.formatRelativeTime(entry.mtime);
    const typeIndicator = entry.isDirectory ? '/' : '';
    return `${entry.path.displayPath}${typeIndicator} (${sizeStr}) - ${timeStr}`;
  }

  private formatRelativeTime(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return 'just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    if (diffDays < 30) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
    if (diffDays < 365) {
      const months = Math.floor(diffDays / 30);
      return `${months} month${months === 1 ? '' : 's'} ago`;
    }
    const years = Math.floor(diffDays / 365);
    return `${years} year${years === 1 ? '' : 's'} ago`;
  }

  private matchesPattern(filename: string, pattern: string): boolean {
    // Always case-insensitive
    const targetName = filename.toLowerCase();
    const targetPattern = pattern.toLowerCase();

    // Convert glob pattern to regex
    const regexPattern = targetPattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special regex chars except * and ?
      .replace(/\*/g, '.*') // * matches any characters
      .replace(/\?/g, '.'); // ? matches single character

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(targetName);
  }

  private handleFileSystemError(error: unknown, dirPath: string): ToolResult {
    if (error instanceof Error) {
      const nodeError = error as Error & { code?: string };

      switch (nodeError.code) {
        case 'ENOENT':
          return this.createError(
            `Directory not found: ${dirPath}. Ensure the directory exists before searching.`
          );

        case 'EACCES':
          return this.createError(
            `Permission denied accessing ${dirPath}. Check directory permissions or choose a different location. File system error: ${error.message}`
          );

        case 'ENOTDIR':
          return this.createError(
            `Path ${dirPath} is not a directory. Specify a directory path to search in.`
          );

        default:
          return this.createError(
            `File search failed: ${error.message}. Check the directory path and search parameters, then try again.`
          );
      }
    }

    return this.createError(
      `File search failed due to unknown error. Check the directory path and search parameters, then try again.`
    );
  }
}
