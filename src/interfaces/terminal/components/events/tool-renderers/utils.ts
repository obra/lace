// ABOUTME: Shared utilities for tool renderers
// ABOUTME: Common helper functions that can be used across multiple tool renderers

/**
 * Truncate text to specified line count with indication of additional content
 */
export function truncateLines(text: string, maxLines: number): { lines: string[]; hasMore: boolean; totalLines: number } {
  const allLines = text.split('\n');
  const lines = allLines.slice(0, maxLines);
  const hasMore = allLines.length > maxLines;
  
  return {
    lines,
    hasMore,
    totalLines: allLines.length,
  };
}

/**
 * Format file size in human readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Extract filename from path
 */
export function getFilename(path: string): string {
  return path.split('/').pop() || path;
}

/**
 * Check if path is a directory path (ends with slash)
 */
export function isDirectoryPath(path: string): boolean {
  return path.endsWith('/');
}

/**
 * Escape special characters for display in terminal
 */
export function escapeForDisplay(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, ''); // Remove ANSI escape sequences
}