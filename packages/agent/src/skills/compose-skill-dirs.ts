// ABOUTME: Compose the per-session skillDirs list (first-wins precedence).
// ABOUTME: persona > plugin > core > embedder/workDir. Plugin/persona/core ALWAYS layer.
import { skillDirs as pluginSkillDirs } from '@lace/agent/plugins';

export function composeSkillDirs(
  source: { skillDirs?: string[] },
  personaSkillsDir: string | null,
  opts: { coreDir?: string }
): string[] {
  const out: string[] = [];
  if (personaSkillsDir) out.push(personaSkillsDir);
  out.push(...pluginSkillDirs().map((d) => d.dir));
  if (opts.coreDir) out.push(opts.coreDir);
  out.push(...(source.skillDirs ?? []));
  return out;
}
