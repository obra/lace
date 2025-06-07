// ABOUTME: Unified completion provider for files and directories  
// ABOUTME: Shows both files and directories in completion results for better UX

import * as fs from 'fs';
import * as path from 'path';
import { CompletionProvider, CompletionResult, CompletionContext, CompletionItem } from './types.js';

export class FilesAndDirectoriesCompletionProvider implements CompletionProvider {
  private cwd: string;
  private maxItems: number;
  private showHidden: boolean;

  constructor(options: { cwd?: string; maxItems?: number; showHidden?: boolean } = {}) {
    this.cwd = options.cwd || process.cwd();
    this.maxItems = options.maxItems || 50;
    this.showHidden = options.showHidden ?? false;
  }

  canHandle(context: CompletionContext): boolean {
    // Handle file completion when not a command (not starting with / on first line)
    return !(context.lineNumber === 0 && context.line.startsWith('/'));
  }

  async getCompletions(prefix: string): Promise<CompletionResult> {
    try {
      const completions = await this.getFileAndDirectoryCompletions(prefix);
      return {
        items: completions,
        prefix,
        hasMore: completions.length >= this.maxItems
      };
    } catch (error) {
      // Return empty result on error rather than throwing
      return {
        items: [],
        prefix,
        hasMore: false
      };
    }
  }

  private async getFileAndDirectoryCompletions(partial: string): Promise<CompletionItem[]> {
    const results: CompletionItem[] = [];
    
    try {
      // Determine directory and filename to match
      const dir = this.resolveDirectory(partial);
      const base = path.basename(partial);
      
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
          const completionType: 'file' | 'directory' = isDirectory ? 'directory' : 'file';
          
          // Add trailing slash for directories for better UX
          if (isDirectory) {
            displayValue += '/';
          }

          results.push({
            value: displayValue,
            description: this.getItemDescription(fullPath, entry, isDirectory),
            type: completionType,
            priority: this.getItemPriority(entry.name, completionType)
          });
        }
      }

      // Sort results: directories first, then by priority, then alphabetically
      results.sort((a, b) => {
        // Directories before files
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        
        // Then by priority (higher first)
        const priorityDiff = (b.priority || 0) - (a.priority || 0);
        if (priorityDiff !== 0) return priorityDiff;
        
        // Finally alphabetically (case insensitive)
        return a.value.toLowerCase().localeCompare(b.value.toLowerCase());
      });

      return results.slice(0, this.maxItems);
      
    } catch (error) {
      console.warn('Files and directories completion error:', error.message);
      return results;
    }
  }

  private resolveDirectory(partial: string): string {
    if (partial.includes('/')) {
      const dir = path.dirname(partial);
      return path.resolve(this.cwd, dir);
    }
    return this.cwd;
  }

  private shouldIncludeEntry(fileName: string, base: string): boolean {
    // Skip hidden files unless explicitly enabled or requested
    if (fileName.startsWith('.') && !this.showHidden && !base.startsWith('.')) {
      return false;
    }
    
    // Match prefix (case insensitive for better UX)
    return fileName.toLowerCase().startsWith(base.toLowerCase());
  }

  private cleanPath(relativePath: string): string {
    // Clean up relative paths
    if (relativePath.startsWith('./')) {
      return relativePath.slice(2);
    }
    
    // If path is empty (current directory), return as-is
    if (relativePath === '') {
      return relativePath;
    }
    
    return relativePath;
  }

  private getItemDescription(fullPath: string, entry: fs.Dirent, isDirectory: boolean): string {
    try {
      if (isDirectory) {
        // For directories, show basic info
        return 'directory';
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
      return isDirectory ? 'directory' : 'file';
    }
  }

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const size = bytes / Math.pow(1024, i);
    
    return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  private getItemPriority(fileName: string, type: 'file' | 'directory'): number {
    // Directories get higher priority for better navigation UX
    if (type === 'directory') return 10;
    
    // Important configuration and documentation files
    const importantFiles = ['README.md', 'package.json', 'tsconfig.json', '.gitignore', 'Makefile'];
    if (importantFiles.includes(fileName)) return 8;
    
    // Source code files
    const sourceExts = ['.js', '.ts', '.tsx', '.jsx', '.py', '.java', '.cpp', '.c', '.go', '.rs'];
    const ext = path.extname(fileName);
    if (sourceExts.includes(ext)) return 6;
    
    // Configuration files
    const configExts = ['.json', '.yaml', '.yml', '.toml', '.ini', '.conf'];
    if (configExts.includes(ext)) return 4;
    
    // Documentation
    if (ext === '.md' || ext === '.txt' || ext === '.rst') return 3;
    
    // Images and media
    const mediaExts = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.mp4', '.mp3'];
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
      showHidden: this.showHidden
    };
  }
}