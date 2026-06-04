// ABOUTME: Discover one-shot-exec tools from a SCOPED directory (never $PATH)
// ABOUTME: Skips non-executable files and binaries with invalid schema output (no throw)
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { logger } from '@lace/agent/utils/logger';
import { parseExecToolDescriptor } from './descriptor';
import { ExecToolAdapter } from './exec-tool-adapter';
import { runExecToolProcess } from './run-once';

export async function discoverExecTools(dir: string): Promise<ExecToolAdapter[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: ExecToolAdapter[] = [];
  for (const entry of entries) {
    const bin = path.join(dir, entry);
    try {
      const st = await fs.stat(bin);
      if (!st.isFile() || (st.mode & 0o111) === 0) continue;
      const { stdout, exitCode } = await runExecToolProcess(bin, ['lace-tool-schema'], {
        stdin: '',
        cwd: dir,
        timeoutMs: 5000,
      });
      if (exitCode !== 0) {
        logger.warn('exectool.schema.nonzero', { bin, exitCode });
        continue;
      }
      out.push(new ExecToolAdapter(bin, parseExecToolDescriptor(stdout)));
    } catch (err) {
      logger.warn('exectool.discover.skipped', {
        bin,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}
