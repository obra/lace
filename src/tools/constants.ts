// ABOUTME: Tool configuration constants and limits
// ABOUTME: Centralized constants to avoid magic numbers across tool implementations

export const TOOL_LIMITS = {
  // File operations
  MAX_WHOLE_FILE_SIZE: 32 * 1024, // 32KB limit for whole file reads
  MAX_RANGE_SIZE: 100, // Maximum number of lines in a ranged read

  // Search and listing operations
  DEFAULT_SEARCH_RESULTS: 50, // Default number of search results
  MAX_SEARCH_RESULTS: 1000, // Maximum search results allowed
  MIN_SEARCH_RESULTS: 1, // Minimum search results

  // Directory traversal
  MAX_DEPTH: 20, // Maximum directory traversal depth
  MIN_DEPTH: 1, // Minimum directory traversal depth
  DEFAULT_DEPTH: 10, // Default directory traversal depth

  // File listing
  DEFAULT_SUMMARY_THRESHOLD: 50, // Default entries before summarizing
  MAX_SUMMARY_THRESHOLD: 200, // Maximum summary threshold
  MIN_SUMMARY_THRESHOLD: 1, // Minimum summary threshold

  // Directory listing max depth
  MAX_LIST_DEPTH: 10, // Maximum depth for file listing
  DEFAULT_LIST_DEPTH: 3, // Default depth for file listing
} as const;

export const FILE_SIZE_UNITS = {
  BYTES_PER_KB: 1024,
} as const;
