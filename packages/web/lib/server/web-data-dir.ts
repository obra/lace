// ABOUTME: Web-owned data directory management (projects, settings, etc.)
// ABOUTME: Stores web-only state outside the agent-owned LACE_DIR

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Get the web data directory.
 * Uses `LACE_WEB_DIR` env var, falls back to `~/.lace_web`.
 */
export function getLaceWebDir(): string {
  return process.env.LACE_WEB_DIR || path.join(os.homedir(), '.lace_web');
}

/**
 * Ensure the web data directory exists.
 * Creates the directory if it doesn't exist and returns the path.
 */
export function ensureLaceWebDir(): string {
  const webDir = getLaceWebDir();

  try {
    if (!fs.existsSync(webDir)) {
      fs.mkdirSync(webDir, { recursive: true });
    }
    return webDir;
  } catch (error) {
    throw new Error(
      `Failed to create Lace web data directory at ${webDir}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

export function getLaceWebFilePath(filename: string): string {
  return path.join(getLaceWebDir(), filename);
}
