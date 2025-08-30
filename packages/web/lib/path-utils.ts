// ABOUTME: Shared utility functions for path encoding and manipulation
// ABOUTME: Provides consistent URL path encoding across file browser components

export function encodePathSegments(filePath: string): string {
  return filePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}
