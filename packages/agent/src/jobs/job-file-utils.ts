// ABOUTME: Job directory and output file management utilities
// This module provides functions to manage job log directories and output files.

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JOB_LOG_DIR } from '../server-types';

export function ensureJobLogDir(sessionDir: string): string {
  const dir = join(sessionDir, JOB_LOG_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function getJobOutputPath(sessionDir: string, jobId: string): string {
  return join(ensureJobLogDir(sessionDir), `${jobId}.log`);
}

/**
 * Get the last N lines from a job output file.
 */
export function getLastLines(outputPath: string, n: number): string[] {
  try {
    const content = readFileSync(outputPath, 'utf8');
    const lines = content.split('\n').filter((line) => line.length > 0);
    return lines.slice(-n);
  } catch {
    return [];
  }
}
