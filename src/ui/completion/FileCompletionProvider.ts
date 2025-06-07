// ABOUTME: File and directory completion provider for path auto-completion
// ABOUTME: Extracted from console.js, provides clean API for filesystem completion

import * as fs from 'fs';
import * as path from 'path';
import { CompletionProvider, CompletionResult, CompletionContext, CompletionItem } from './types.js';

export class FileCompletionProvider implements CompletionProvider {
  private cwd: string;
  private maxItems: number;

  constructor(options: { cwd?: string; maxItems?: number } = {}) {
    this.cwd = options.cwd || process.cwd();
    this.maxItems = options.maxItems || 50;
  }

  canHandle(context: CompletionContext): boolean {
    // Handle file completion when not a command (not starting with /)
    return !(context.lineNumber === 0 && context.line.startsWith('/'));
  }

  async getCompletions(prefix: string): Promise<CompletionResult> {
    try {
      const completions = await this.getFileCompletions(prefix);
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

  private async getFileCompletions(partial: string): Promise<CompletionItem[]> {
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
          
          // Determine display value and type
          let displayValue = relativePath;
          let completionType: 'file' | 'directory' = 'file';
          
          if (entry.isDirectory()) {
            displayValue += '/';
            completionType = 'directory';
          }
          
          // For relative paths starting with current directory, clean up display
          if (displayValue.startsWith('./')) {
            displayValue = displayValue.slice(2);
          }

          results.push({
            value: displayValue,
            description: this.getFileDescription(fullPath, entry),
            type: completionType,
            priority: this.getFilePriority(entry.name, completionType)
          });
        }
      }

      // Sort results: directories first, then by priority, then alphabetically
      results.sort((a, b) => {
        // Directories before files
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        
        // Then by priority
        const priorityDiff = (b.priority || 0) - (a.priority || 0);
        if (priorityDiff !== 0) return priorityDiff;
        
        // Finally alphabetically
        return a.value.localeCompare(b.value);
      });

      return results.slice(0, this.maxItems);
      
    } catch (error) {
      console.warn('File completion error:', error.message);
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
    // Skip hidden files unless explicitly requested
    if (fileName.startsWith('.') && !base.startsWith('.')) {
      return false;
    }
    
    // Match prefix
    return fileName.toLowerCase().startsWith(base.toLowerCase());
  }

  private getFileDescription(fullPath: string, entry: fs.Dirent): string {
    try {
      const stats = fs.statSync(fullPath);
      
      if (entry.isDirectory()) {
        return 'directory';
      }
      
      // Show file size for regular files
      const size = this.formatFileSize(stats.size);
      const ext = path.extname(entry.name).slice(1);
      
      return ext ? `${ext} file (${size})` : `file (${size})`;
      
    } catch {
      return entry.isDirectory() ? 'directory' : 'file';
    }
  }

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const size = bytes / Math.pow(1024, i);
    
    return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  private getFilePriority(fileName: string, type: 'file' | 'directory'): number {
    // Directories get higher priority
    if (type === 'directory') return 10;
    
    // Common important files
    const importantFiles = ['README.md', 'package.json', 'tsconfig.json', '.gitignore'];
    if (importantFiles.includes(fileName)) return 8;
    
    // Source files
    const sourceExts = ['.js', '.ts', '.tsx', '.jsx', '.py', '.java', '.cpp', '.c'];
    const ext = path.extname(fileName);
    if (sourceExts.includes(ext)) return 5;
    
    // Documentation files
    if (ext === '.md' || ext === '.txt') return 3;
    
    return 0;
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
}