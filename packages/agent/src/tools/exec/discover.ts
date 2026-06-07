// ABOUTME: Discover one-shot-exec tools from a SCOPED directory (never $PATH)
// ABOUTME: Skips non-executable files and binaries with invalid schema output (no throw)
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '@lace/agent/utils/logger';
import { parseExecToolDescriptor } from './descriptor';
import { ExecToolAdapter } from './exec-tool-adapter';
import { runExecToolSchemaSync } from './run-once';

const PER_BINARY_MS = 5000;
const TOTAL_BUDGET_MS = 30000;
const MAX_BINARIES = 64;

export function discoverExecToolsSync(
  dir: string,
  namePrefix = '',
  trustedCredentialProvenance = false
): ExecToolAdapter[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: ExecToolAdapter[] = [];
  const startedAt = Date.now();
  let count = 0;
  for (const entry of entries) {
    if (count >= MAX_BINARIES) {
      logger.warn('exectool.discover.cap', { dir, cap: MAX_BINARIES });
      break;
    }
    if (Date.now() - startedAt > TOTAL_BUDGET_MS) {
      logger.warn('exectool.discover.budget', { dir });
      break;
    }
    const bin = join(dir, entry);
    try {
      const st = statSync(bin);
      if (!st.isFile() || (st.mode & 0o111) === 0) continue;
      count++;
      const { stdout, exitCode } = runExecToolSchemaSync(bin, dir, PER_BINARY_MS);
      if (exitCode !== 0) {
        logger.warn('exectool.schema.nonzero', { bin, exitCode });
        continue;
      }
      const desc = parseExecToolDescriptor(stdout);
      const name = namePrefix ? `${namePrefix}${desc.name}` : desc.name;
      out.push(new ExecToolAdapter(bin, desc, name, trustedCredentialProvenance));
    } catch (err) {
      logger.warn('exectool.discover.skipped', {
        bin,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}
