// ABOUTME: Shared utility for formatting file sizes into human-readable strings
// ABOUTME: Provides consistent file size formatting across the application

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  // Clamp index to prevent array out of bounds
  const clampedIndex = Math.max(0, Math.min(i, sizes.length - 1));
  return parseFloat((bytes / Math.pow(k, clampedIndex)).toFixed(1)) + ' ' + sizes[clampedIndex];
}