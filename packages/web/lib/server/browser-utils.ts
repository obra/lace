// ABOUTME: Browser opening utilities for development server
// ABOUTME: Handles opening URLs in the user's default browser with error handling

import open from 'open';

/**
 * Opens a URL in the user's default browser
 * Used by the development server for better UX
 */
export async function openBrowser(url: string): Promise<void> {
  try {
    console.warn(`🔍 DEBUG: Attempting to open browser at ${url}...`);
    await open(url);
  } catch (error) {
    const errorCode = (error as NodeJS.ErrnoException).code || 'unknown error';
    const errorMessage = (error as Error).message || 'unknown message';
    console.error(`🔍 DEBUG: ❌ Browser opening failed: ${errorMessage} (${errorCode})`);
  }
}

/**
 * Determines if we should open the browser based on the environment
 */
export function shouldOpenBrowser(
  stdin: { isTTY?: boolean } = process.stdin,
  stdout: { isTTY?: boolean } = process.stdout
): boolean {
  return !!(stdin.isTTY && stdout.isTTY);
}
