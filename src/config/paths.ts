// ABOUTME: Client-safe path utilities that don't require Node.js modules
// ABOUTME: Provides paths for configuration files without importing fs/path

/**
 * Get the path to the user instructions file
 * This is client-safe and doesn't require Node.js modules
 */
export function getUserInstructionsFilePath(): string {
  return '~/.lace/instructions.md';
}

/**
 * Get the path to the project instructions file
 * This is client-safe and doesn't require Node.js modules
 */
export function getProjectInstructionsFilePath(): string {
  return './CLAUDE.md';
}