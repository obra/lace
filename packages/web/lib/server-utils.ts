// ABOUTME: Server utility functions for web server startup and configuration  
// ABOUTME: Contains pure functions that can be tested independently of server execution

import { generateOneTimeLoginURL } from './server/auth-service';

/**
 * Detect if running interactively (both stdin and stdout are TTYs)
 */
export function isInteractive(
  stdin: { isTTY?: boolean } = process.stdin,
  stdout: { isTTY?: boolean } = process.stdout
): boolean {
  return !!(stdin.isTTY && stdout.isTTY);
}

/**
 * Generate auto-login URL for CLI integration
 */
export async function generateAutoLoginURL(baseUrl: string): Promise<string> {
  return generateOneTimeLoginURL(baseUrl);
}

/**
 * Display auto-login information when authentication is required
 */
export async function displayAutoLoginInfo(baseUrl: string): Promise<void> {
  try {
    const autoLoginUrl = await generateAutoLoginURL(baseUrl);
    console.log(`   🔐 Auto-login URL: ${autoLoginUrl}`);
    console.log(`   ⏱️  This URL will expire in 30 seconds`);
  } catch (error) {
    console.warn(`   ⚠️  Could not generate auto-login URL: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
