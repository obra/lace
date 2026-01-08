// ABOUTME: Web-local helpers for ensuring the agent/supervisor LACE_DIR exists
// ABOUTME: Duplicates minimal functionality from the agent package to avoid reach-ins

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Get the Lace configuration directory for agent/supervisor state.
 * Uses `LACE_DIR` env var, falls back to `~/.lace`.
 */
export function getLaceDir(): string {
  return process.env.LACE_DIR || path.join(os.homedir(), '.lace');
}

/**
 * Ensure the Lace configuration directory exists (agent/supervisor state).
 * Creates the directory if it doesn't exist and returns the path.
 */
export function ensureLaceDir(): string {
  const laceDir = getLaceDir();

  try {
    if (!fs.existsSync(laceDir)) {
      fs.mkdirSync(laceDir, { recursive: true });
    }
    return laceDir;
  } catch (error) {
    throw new Error(
      `Failed to create Lace configuration directory at ${laceDir}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
