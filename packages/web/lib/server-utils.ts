// ABOUTME: Server utility functions for web server startup and configuration
// ABOUTME: Contains pure functions that can be tested independently of server execution

/**
 * Detect if running interactively (both stdin and stdout are TTYs)
 */
export function isInteractive(
  stdin: { isTTY?: boolean } = process.stdin,
  stdout: { isTTY?: boolean } = process.stdout
): boolean {
  return !!(stdin.isTTY && stdout.isTTY);
}
