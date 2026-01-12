// ABOUTME: Shared utility for formatting file sizes in human-readable format
// ABOUTME: Used by file tools (file_read, file_write, file_find) for consistent output

/**
 * Formats a file size in bytes to a human-readable string.
 * Uses binary units (1024 bytes = 1 KB).
 *
 * @param bytes - The file size in bytes
 * @returns A formatted string like "1.5 KB", "256 bytes", or "1 byte"
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 bytes';
  if (bytes === 1) return '1 byte';
  if (bytes < 1024) return `${bytes} bytes`;

  const k = 1024;
  const sizes = ['bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = parseFloat((bytes / Math.pow(k, i)).toFixed(1));

  return `${size} ${sizes[i]}`;
}
