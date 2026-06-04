// ABOUTME: Register discovered exec tools into registries.tools (core + plugin-global tiers).
import { existsSync } from 'node:fs';
import { registries } from '@lace/agent/plugins';
import { logger } from '@lace/agent/utils/logger';
import { discoverExecToolsSync } from './discover';

export function registerExecDirInto(
  dir: string,
  opts: { namespace?: string; owner: string }
): void {
  if (!existsSync(dir)) return; // FS-only; absent → no-op
  const prefix = opts.namespace ? `${opts.namespace}:` : '';
  for (const tool of discoverExecToolsSync(dir, prefix)) {
    registries.tools.register(tool.name, tool, opts.owner);
  }
}

export function registerCoreExecTools(coreDir: string): void {
  if (!existsSync(coreDir)) {
    logger.warn('exectool.core.absent', { coreDir }); // FS-only (embedded/standalone unsupported)
    return;
  }
  registerExecDirInto(coreDir, { owner: 'core-exec' });
}
