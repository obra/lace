// ABOUTME: Job output file reading utilities with truncation and offset support
// Consolidates duplicated output reading logic from RPC handlers, tools, and runner

import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs';

/** Default maximum output size (1MB) */
export const MAX_OUTPUT_SIZE = 1024 * 1024;

/** Default tail limit for delegate-style reads (64KB) */
export const DEFAULT_TAIL_LIMIT = 64 * 1024;

export interface JobOutputResult {
  /** The output content read from the file */
  output: string;
  /** Whether the output was truncated */
  truncated: boolean;
  /** Total size of the output file in bytes */
  totalBytes: number;
  /** Byte offset where reading started */
  returnedOffset: number;
  /** Number of bytes returned */
  returnedBytes: number;
}

export interface ReadJobOutputOptions {
  /** Maximum bytes to return (default: MAX_OUTPUT_SIZE) */
  maxSize?: number;
  /** Start reading after this byte offset (default: 0) */
  afterOffset?: number;
  /** Read only the last N bytes of the file */
  tailBytes?: number;
}

/**
 * Read job output from file with offset and truncation support.
 *
 * When both afterOffset and tailBytes are specified, the effective start
 * offset is the maximum of afterOffset and (totalBytes - tailBytes).
 *
 * @param outputPath - Path to the job output file
 * @param options - Reading options
 * @returns Job output result with metadata
 */
export function readJobOutput(outputPath: string, options?: ReadJobOutputOptions): JobOutputResult {
  const maxSize = options?.maxSize ?? MAX_OUTPUT_SIZE;
  const afterOffset = options?.afterOffset ?? 0;
  const tailBytes = options?.tailBytes ?? 0;

  let totalBytes = 0;
  try {
    totalBytes = statSync(outputPath).size;
  } catch {
    return {
      output: '',
      truncated: false,
      totalBytes: 0,
      returnedOffset: 0,
      returnedBytes: 0,
    };
  }

  // Calculate effective start offset
  const clampedAfter = Math.min(afterOffset, totalBytes);
  const startOffset = tailBytes > 0 ? Math.max(clampedAfter, totalBytes - tailBytes) : clampedAfter;

  // Calculate bytes to read, respecting maxSize
  const availableBytes = Math.max(0, totalBytes - startOffset);
  const bytesToRead = Math.min(availableBytes, maxSize);

  // Truncation occurs when:
  // - tailBytes forced us to skip earlier content (startOffset > afterOffset means tail moved us forward)
  // - maxSize limit cuts off content we would have returned
  // Note: afterOffset alone is NOT truncation - caller is requesting continuation
  const tailTruncated = tailBytes > 0 && startOffset > clampedAfter;
  const sizeTruncated = availableBytes > maxSize;
  const truncated = tailTruncated || sizeTruncated;

  let output = '';
  if (bytesToRead > 0) {
    const fd = openSync(outputPath, 'r');
    try {
      const buf = Buffer.allocUnsafe(bytesToRead);
      const read = readSync(fd, buf, 0, bytesToRead, startOffset);
      output = buf.subarray(0, read).toString('utf8');
    } finally {
      closeSync(fd);
    }
  }

  return {
    output,
    truncated,
    totalBytes,
    returnedOffset: startOffset,
    returnedBytes: Buffer.byteLength(output, 'utf8'),
  };
}

export interface JobOutputTailResult {
  /** The output content (may be truncated from the start) */
  output: string;
  /** Whether the output was truncated */
  truncated: boolean;
}

/**
 * Read job output with tail-based truncation (for delegate tool pattern).
 *
 * Returns the last tailLimit bytes of the file if it exceeds that size.
 * This is a simplified interface for the common case of reading the
 * end of a potentially large output file.
 *
 * @param outputPath - Path to the job output file
 * @param tailLimit - Maximum bytes to return (default: 64KB)
 * @returns Output content and truncation flag
 */
export function readJobOutputTail(
  outputPath: string,
  tailLimit: number = DEFAULT_TAIL_LIMIT
): JobOutputTailResult {
  let content: string;
  try {
    content = readFileSync(outputPath, 'utf8');
  } catch {
    return { output: '', truncated: false };
  }

  if (content.length <= tailLimit) {
    return { output: content, truncated: false };
  }

  return {
    output: content.slice(-tailLimit),
    truncated: true,
  };
}
