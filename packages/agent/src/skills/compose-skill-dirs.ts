// ABOUTME: Compose the per-session skillDirs list (first-wins precedence).
// ABOUTME: persona > plugin > core > embedder/workDir. Plugin/persona/core ALWAYS layer.
import { skillDirs as pluginSkillDirs } from '@lace/agent/plugins';
import type { SkillDirEntry } from './types';

// Plugin dirs carry their plugin namespace; persona and core dirs have none.
export function composeSkillDirs(
  source: { skillDirs?: SkillDirEntry[] },
  personaSkillsDir: string | null,
  opts: { coreDir?: string }
): SkillDirEntry[] {
  const out: SkillDirEntry[] = [];
  if (personaSkillsDir) out.push(personaSkillsDir);
  out.push(...pluginSkillDirs().map((d) => ({ dir: d.dir, namespace: d.namespace })));
  if (opts.coreDir) out.push(opts.coreDir);
  out.push(...(source.skillDirs ?? []));
  return out;
}
