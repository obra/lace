// ABOUTME: Resolves the bundled agent-skills core directory ESM-safely.
// Returns the absolute path when the directory exists, else undefined.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const _agentSkillsDir: string = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../config/agent-skills'
);

/**
 * Returns the bundled agent-skills core directory if it exists on disk,
 * or undefined when running in a context where the directory is absent.
 * Callers pass the result as `coreDir` to composeSkillDirs.
 */
export function getAgentSkillsDir(): string | undefined {
  return existsSync(_agentSkillsDir) ? _agentSkillsDir : undefined;
}
