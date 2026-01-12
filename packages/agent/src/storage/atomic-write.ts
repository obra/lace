// ABOUTME: Minimal helper for crash-safe(ish) JSON writes via temp-file + rename
// ABOUTME: Prevents partial writes corrupting the target JSON file

import * as fs from 'node:fs';
import * as path from 'node:path';

// Wrap fs methods in a mutable object so tests can spy/mock them under ESM.
export const fsOps = {
  writeFileSync: fs.writeFileSync,
  renameSync: fs.renameSync,
  unlinkSync: fs.unlinkSync,
};

export function atomicWriteJson(
  targetPath: string,
  value: unknown,
  options?: { mode?: number }
): void {
  const dir = path.dirname(targetPath);
  const base = path.basename(targetPath);
  const tmpPath = path.join(
    dir,
    `.tmp-${base}-${process.pid}-${Math.random().toString(16).slice(2)}`
  );

  const mode = options?.mode;
  const contents = JSON.stringify(value, null, 2);

  try {
    fsOps.writeFileSync(tmpPath, contents, {
      encoding: 'utf8',
      ...(mode !== undefined ? { mode } : {}),
    });
    fsOps.renameSync(tmpPath, targetPath);
  } catch (error) {
    try {
      fsOps.unlinkSync(tmpPath);
    } catch {
      // ignore cleanup errors
    }
    throw error;
  }
}
