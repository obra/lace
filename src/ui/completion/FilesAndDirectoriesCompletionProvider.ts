// ABOUTME: Unified completion provider for files and directories
// ABOUTME: Shows both files and directories in completion results for better UX

import * as fs from "fs";
import * as path from "path";
import {
  CompletionProvider,
  CompletionResult,
  CompletionContext,
  CompletionItem,
} from "./types.js";

export class FilesAndDirectoriesCompletionProvider
  implements CompletionProvider
{
  private cwd: string;
  private maxItems: number;
  private showHidden: boolean;

  constructor(
    options: { cwd?: string; maxItems?: number; showHidden?: boolean } = {},
  ) {
    this.cwd = options.cwd || process.cwd();
    this.maxItems = options.maxItems || 50;
    this.showHidden = options.showHidden ?? false;
  }

  canHandle(context: CompletionContext): boolean {
    // Handle file completion when not a command (not starting with / on first line)
    return !(context.lineNumber === 0 && context.line.startsWith("/"));
  }

  async getCompletions(prefix: string): Promise<CompletionResult> {
    try {
      const completions = await this.getFileAndDirectoryCompletions(prefix);
      return {
        items: completions,
        prefix,
        hasMore: completions.length >= this.maxItems,
      };
    } catch (error) {
      // Return empty result on error rather than throwing
      return {
        items: [],
        prefix,
        hasMore: false,
      };
    }
  }

  private async getFileAndDirectoryCompletions(
    partial: string,
  ): Promise<CompletionItem[]> {
    const results: CompletionItem[] = [];

    try {
      // If partial contains "/" try path-based completion first
      if (partial.includes("/")) {
        const pathResults = await this.getPathBasedCompletions(partial);
        results.push(...pathResults);
      }

      // Always do fuzzy search across entire directory tree
      const fuzzyResults = await this.getFuzzyCompletions(partial);
      results.push(...fuzzyResults);

      // Remove duplicates (prefer path-based results)
      const seen = new Set<string>();
      const uniqueResults = results.filter((item) => {
        if (seen.has(item.value)) {
          return false;
        }
        seen.add(item.value);
        return true;
      });

      // Sort results: directories first, then by priority, then alphabetically
      uniqueResults.sort((a, b) => {
        // Directories before files
        if (a.type !== b.type) {
          return a.type === "directory" ? -1 : 1;
        }

        // Then by priority (higher first)
        const priorityDiff = (b.priority || 0) - (a.priority || 0);
        if (priorityDiff !== 0) return priorityDiff;

        // Finally alphabetically (case insensitive)
        return a.value.toLowerCase().localeCompare(b.value.toLowerCase());
      });

      return uniqueResults.slice(0, this.maxItems);
    } catch (error) {
      console.warn("Files and directories completion error:", error.message);
      return results;
    }
  }

  private async getPathBasedCompletions(
    partial: string,
  ): Promise<CompletionItem[]> {
    const results: CompletionItem[] = [];

    try {
      // Determine directory and filename to match
      const dir = this.resolveDirectory(partial);
      let base = path.basename(partial);

      // If partial ends with '/', user wants to complete all files in that directory
      if (partial.endsWith("/")) {
        base = "";
      }

      if (!fs.existsSync(dir)) {
        return results;
      }

      const entries = await fs.promises.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (this.shouldIncludeEntry(entry.name, base)) {
          const fullPath = path.join(dir, entry.name);
          const relativePath = path.relative(this.cwd, fullPath);

          // Clean up the display path
          let displayValue = this.cleanPath(relativePath);

          // Determine type and add directory indicator
          const isDirectory = entry.isDirectory();
          const completionType: "file" | "directory" = isDirectory
            ? "directory"
            : "file";

          // Add trailing slash for directories for better UX
          if (isDirectory) {
            displayValue += "/";
          }

          results.push({
            value: displayValue,
            description: this.getItemDescription(fullPath, entry, isDirectory),
            type: completionType,
            priority: this.getItemPriority(entry.name, completionType) + 5, // Boost path-based results
          });
        }
      }

      return results;
    } catch (error) {
      console.warn("Path-based completion error:", error.message);
      return results;
    }
  }

  private async getFuzzyCompletions(
    partial: string,
  ): Promise<CompletionItem[]> {
    if (!partial.trim()) {
      return [];
    }

    const results: CompletionItem[] = [];
    const searchTerm = partial.toLowerCase();
    const isExplicitPath = partial.includes("/");

    try {
      await this.walkDirectory(
        this.cwd,
        (filePath, stats, relativeFromCwd) => {
          const fileName = path.basename(filePath);
          const fileNameLower = fileName.toLowerCase();
          const relativeLower = relativeFromCwd.toLowerCase();

          // Fuzzy match: filename starts with term, contains term, or path contains term
          const nameMatch =
            fileNameLower.startsWith(searchTerm) ||
            fileNameLower.includes(searchTerm);
          const pathMatch = relativeLower.includes(searchTerm);

          if (nameMatch || pathMatch) {
            let displayValue = relativeFromCwd;
            const isDirectory = stats.isDirectory();
            const completionType: "file" | "directory" = isDirectory
              ? "directory"
              : "file";

            // Add trailing slash for directories
            if (isDirectory) {
              displayValue += "/";
            }

            // Calculate fuzzy match priority
            let fuzzyPriority = 0;
            if (fileNameLower.startsWith(searchTerm)) {
              fuzzyPriority = 20; // Highest for prefix match on filename
            } else if (fileNameLower.includes(searchTerm)) {
              fuzzyPriority = 10; // Medium for substring match on filename
            } else if (pathMatch) {
              fuzzyPriority = 5; // Lower for path match
            }

            results.push({
              value: displayValue,
              description: this.getItemDescriptionFromStats(
                filePath,
                fileName,
                isDirectory,
                stats,
              ),
              type: completionType,
              priority:
                this.getItemPriority(fileName, completionType) + fuzzyPriority,
            });
          }
        },
        isExplicitPath ? partial : "",
      );

      return results;
    } catch (error) {
      console.warn("Fuzzy completion error:", error.message);
      return results;
    }
  }

  private async walkDirectory(
    dir: string,
    callback: (
      filePath: string,
      stats: fs.Stats,
      relativeFromCwd: string,
    ) => void,
    explicitPath: string = "",
    maxDepth: number = 10,
    currentDepth: number = 0,
  ): Promise<void> {
    if (currentDepth >= maxDepth) {
      return;
    }

    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        // Skip hidden files unless explicitly enabled
        if (
          entry.name.startsWith(".") &&
          !this.showHidden &&
          !explicitPath.startsWith(".")
        ) {
          continue;
        }

        const fullPath = path.join(dir, entry.name);
        const relativeFromCwd = path.relative(this.cwd, fullPath);

        // Check if this path should be included based on gitignore and explicit path
        if (!this.shouldIncludePath(relativeFromCwd, explicitPath)) {
          continue;
        }

        try {
          const stats = await fs.promises.stat(fullPath);
          callback(fullPath, stats, relativeFromCwd);

          // Recurse into directories
          if (entry.isDirectory()) {
            await this.walkDirectory(
              fullPath,
              callback,
              explicitPath,
              maxDepth,
              currentDepth + 1,
            );
          }
        } catch (statError) {
          // Skip files we can't stat (permissions, broken symlinks, etc)
          continue;
        }
      }
    } catch (error) {
      // Skip directories we can't read
      return;
    }
  }

  private shouldIncludePath(
    relativePath: string,
    explicitPath: string,
  ): boolean {
    // If user typed an explicit path that matches or contains this path, always include
    if (
      explicitPath &&
      (relativePath.startsWith(explicitPath) ||
        explicitPath.startsWith(relativePath))
    ) {
      return true;
    }

    // Otherwise, check against gitignore patterns
    return !this.isIgnoredByGitignore(relativePath);
  }

  private isIgnoredByGitignore(relativePath: string): boolean {
    // Simple gitignore-like patterns (could be enhanced to read actual .gitignore)
    const gitignorePatterns = [
      "node_modules",
      ".git",
      ".svn",
      ".hg",
      "dist",
      "build",
      "target",
      ".next",
      ".nuxt",
      "vendor",
      "*.log",
      ".DS_Store",
      "Thumbs.db",
    ];

    const pathParts = relativePath.split(path.sep);

    for (const pattern of gitignorePatterns) {
      if (pattern.includes("*")) {
        // Simple glob pattern matching
        const regex = new RegExp(pattern.replace(/\*/g, ".*"));
        if (pathParts.some((part) => regex.test(part))) {
          return true;
        }
      } else {
        // Direct directory/file name matching
        if (pathParts.includes(pattern)) {
          return true;
        }
      }
    }

    return false;
  }

  private getItemDescriptionFromStats(
    fullPath: string,
    fileName: string,
    isDirectory: boolean,
    stats: fs.Stats,
  ): string {
    try {
      if (isDirectory) {
        return "directory";
      }

      // For files, show size and type
      const size = this.formatFileSize(stats.size);
      const ext = path.extname(fileName).slice(1);

      if (ext) {
        return `${ext} file (${size})`;
      } else {
        return `file (${size})`;
      }
    } catch {
      return isDirectory ? "directory" : "file";
    }
  }

  private resolveDirectory(partial: string): string {
    if (partial.includes("/")) {
      let dir: string;
      if (partial.endsWith("/")) {
        // If partial ends with '/', use the directory itself (remove trailing slash)
        dir = partial.slice(0, -1);
      } else {
        // Otherwise use the directory part of the path
        dir = path.dirname(partial);
      }
      return path.resolve(this.cwd, dir);
    }
    return this.cwd;
  }

  private shouldIncludeEntry(fileName: string, base: string): boolean {
    // Skip hidden files unless explicitly enabled or requested
    if (fileName.startsWith(".") && !this.showHidden && !base.startsWith(".")) {
      return false;
    }

    // Match prefix (case insensitive for better UX)
    return fileName.toLowerCase().startsWith(base.toLowerCase());
  }

  private cleanPath(relativePath: string): string {
    // Clean up relative paths
    if (relativePath.startsWith("./")) {
      return relativePath.slice(2);
    }

    // If path is empty (current directory), return as-is
    if (relativePath === "") {
      return relativePath;
    }

    return relativePath;
  }

  private getItemDescription(
    fullPath: string,
    entry: fs.Dirent,
    isDirectory: boolean,
  ): string {
    try {
      if (isDirectory) {
        // For directories, show basic info
        return "directory";
      }

      // For files, show size and type
      const stats = fs.statSync(fullPath);
      const size = this.formatFileSize(stats.size);
      const ext = path.extname(entry.name).slice(1);

      if (ext) {
        return `${ext} file (${size})`;
      } else {
        return `file (${size})`;
      }
    } catch {
      return isDirectory ? "directory" : "file";
    }
  }

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return "0 B";

    const units = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const size = bytes / Math.pow(1024, i);

    return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  private getItemPriority(
    fileName: string,
    type: "file" | "directory",
  ): number {
    // Directories get higher priority for better navigation UX
    if (type === "directory") return 10;

    // Important configuration and documentation files
    const importantFiles = [
      "README.md",
      "package.json",
      "tsconfig.json",
      ".gitignore",
      "Makefile",
    ];
    if (importantFiles.includes(fileName)) return 8;

    // Source code files
    const sourceExts = [
      ".js",
      ".ts",
      ".tsx",
      ".jsx",
      ".py",
      ".java",
      ".cpp",
      ".c",
      ".go",
      ".rs",
    ];
    const ext = path.extname(fileName);
    if (sourceExts.includes(ext)) return 6;

    // Configuration files
    const configExts = [".json", ".yaml", ".yml", ".toml", ".ini", ".conf"];
    if (configExts.includes(ext)) return 4;

    // Documentation
    if (ext === ".md" || ext === ".txt" || ext === ".rst") return 3;

    // Images and media
    const mediaExts = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".mp4", ".mp3"];
    if (mediaExts.includes(ext)) return 2;

    return 1; // Default priority for other files
  }

  /**
   * Update the current working directory
   */
  setCwd(newCwd: string) {
    this.cwd = path.resolve(newCwd);
  }

  /**
   * Get the current working directory
   */
  getCwd(): string {
    return this.cwd;
  }

  /**
   * Update whether to show hidden files
   */
  setShowHidden(show: boolean) {
    this.showHidden = show;
  }

  /**
   * Get current settings
   */
  getSettings() {
    return {
      cwd: this.cwd,
      maxItems: this.maxItems,
      showHidden: this.showHidden,
    };
  }
}
