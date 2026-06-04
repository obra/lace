// ABOUTME: E2E integration test proving the subagent skillDir hand-off flow:
// ABOUTME: parent ships raw embedder tier → child re-composes (persona + raw) → persona P's skills appear, persona Q's don't.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestTempDir } from '@lace/agent/test-utils';
import { PersonaRegistry } from '../../config/persona-registry';
import { composeSkillDirs } from '../compose-skill-dirs';
import { SkillRegistry } from '../registry';
import { getSkillDirectories } from '../directories';
import { resetContributedDirsForTest } from '@lace/agent/plugins';

/**
 * Creates a minimal persona .md file so PersonaRegistry can discover it.
 */
async function createPersona(personasDir: string, name: string): Promise<void> {
  await writeFile(
    join(personasDir, `${name}.md`),
    `---\nname: ${name}\n---\n\nPersona body for ${name}.`
  );
}

/**
 * Creates a skill directory with a valid SKILL.md under a parent skills dir.
 * The directory name must match the skill name (registry rule).
 */
async function createSkillDir(
  parentDir: string,
  skillName: string,
  description = `Description for ${skillName}`
): Promise<void> {
  const skillDir = join(parentDir, skillName);
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, 'SKILL.md'),
    `---\nname: ${skillName}\ndescription: ${description}\n---\n\n# ${skillName}\n\nInstructions.`
  );
}

/**
 * Simulates what getSubagentHostSkillDirs does in subagent-job.ts:
 * return state.skillDirs if set, else getSkillDirectories(workDir).
 *
 * This is the RAW embedder/workDir tier — it intentionally omits any persona or
 * plugin layers. The child re-composes those on its own side.
 */
function simulateGetSubagentHostSkillDirs(opts: {
  stateDotSkillDirs?: string[];
  workDir?: string;
}): string[] {
  if (opts.stateDotSkillDirs !== undefined) return opts.stateDotSkillDirs;
  return getSkillDirectories(opts.workDir);
}

describe('subagent per-persona skills e2e', () => {
  const tempDir = createTestTempDir('subagent-per-persona-skills-e2e-');
  let testDir: string;

  beforeEach(async () => {
    testDir = await tempDir.getPath();
    // Keep plugin skill dirs clean between tests.
    resetContributedDirsForTest();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  it('child sees persona P skills after re-composing from raw parent tier (Option A flow)', async () => {
    // --- Setup ---
    // User personas dir with two personas: "ada" (has skills) and "scout" (no skills).
    const personasDir = join(testDir, 'personas');
    await mkdir(personasDir, { recursive: true });
    await createPersona(personasDir, 'ada');
    await createPersona(personasDir, 'scout');

    // Give "ada" a skills directory with a skill.
    const adaSkillsDir = join(personasDir, 'ada', 'skills');
    await mkdir(adaSkillsDir, { recursive: true });
    await createSkillDir(adaSkillsDir, 'ada-special-skill');

    // Embedder workDir has its own skill (raw tier — the parent ships this to the child).
    const workDir = join(testDir, 'workdir');
    await mkdir(join(workDir, '.lace', 'skills'), { recursive: true });
    await createSkillDir(join(workDir, '.lace', 'skills'), 'workdir-skill');

    const personaRegistry = new PersonaRegistry({
      bundledPersonasPath: join(testDir, 'nonexistent-bundled'),
      userPersonasPaths: [personasDir],
    });

    // --- Step 1: Parent computes raw skillDirs for the child ---
    // This replicates getSubagentHostSkillDirs(state) in subagent-job.ts.
    const rawSkillDirsFromParent = simulateGetSubagentHostSkillDirs({ workDir });

    // Sanity: raw tier must NOT contain ada's skills dir (no double-composition).
    expect(rawSkillDirsFromParent).not.toContain(adaSkillsDir);
    expect(rawSkillDirsFromParent.some((d) => d.includes('/ada/skills'))).toBe(false);

    // --- Step 2: Child re-composes for persona "ada" ---
    // This mirrors what the child does during initialize/session/new:
    //   const childSkillDirs = composeSkillDirs(
    //     { skillDirs: rawFromParent },
    //     personaRegistry.personaSkillsDir('ada'),
    //     { coreDir: undefined }
    //   );
    const adaPersonaSkillsDir = personaRegistry.personaSkillsDir('ada');
    expect(adaPersonaSkillsDir).not.toBeNull();
    expect(adaPersonaSkillsDir).toBe(adaSkillsDir);

    const adaChildSkillDirs = composeSkillDirs(
      { skillDirs: rawSkillDirsFromParent },
      adaPersonaSkillsDir,
      { coreDir: undefined }
    );

    // --- Step 3: Build child SkillRegistry and assert ---
    const adaRegistry = new SkillRegistry({ skillDirs: adaChildSkillDirs });

    // Child running as "ada" sees ada's persona skill.
    expect(adaRegistry.getSkill('ada-special-skill')).not.toBeNull();
    // Child also sees the embedder workdir skill (raw tier flows through).
    expect(adaRegistry.getSkill('workdir-skill')).not.toBeNull();
    // ada's persona skill dir appears BEFORE the raw embedder tier in the list.
    const adaSkillsDirIndex = adaChildSkillDirs.indexOf(adaSkillsDir);
    const firstRawDirIndex = adaChildSkillDirs.indexOf(rawSkillDirsFromParent[0]);
    expect(adaSkillsDirIndex).toBeLessThan(firstRawDirIndex);
  });

  it('child running as persona Q (no skills dir) does NOT see persona P skills — isolation', async () => {
    // Same setup as above, but the child runs as "scout" (no skills dir).
    const personasDir = join(testDir, 'personas');
    await mkdir(personasDir, { recursive: true });
    await createPersona(personasDir, 'ada');
    await createPersona(personasDir, 'scout');

    const adaSkillsDir = join(personasDir, 'ada', 'skills');
    await mkdir(adaSkillsDir, { recursive: true });
    await createSkillDir(adaSkillsDir, 'ada-special-skill');

    const personaRegistry = new PersonaRegistry({
      bundledPersonasPath: join(testDir, 'nonexistent-bundled'),
      userPersonasPaths: [personasDir],
    });

    const rawSkillDirsFromParent = simulateGetSubagentHostSkillDirs({
      stateDotSkillDirs: [], // explicit empty — common when embedder provides no custom dirs
    });

    // "scout" has no skills dir.
    expect(personaRegistry.personaSkillsDir('scout')).toBeNull();

    const scoutChildSkillDirs = composeSkillDirs(
      { skillDirs: rawSkillDirsFromParent },
      personaRegistry.personaSkillsDir('scout'),
      { coreDir: undefined }
    );

    const scoutRegistry = new SkillRegistry({ skillDirs: scoutChildSkillDirs });

    // ada's skill must NOT be visible when persona is "scout".
    expect(scoutRegistry.getSkill('ada-special-skill')).toBeNull();
    // ada's skills dir must not appear anywhere in scout's composed dirs.
    expect(scoutChildSkillDirs.some((d) => d.includes('/ada/skills'))).toBe(false);
  });

  it('no double-composition: raw parent tier never contains the persona skills dir', async () => {
    // Proves the architectural invariant: the parent ships ONLY the raw embedder
    // tier; it never pre-composes the persona layer so the child can't end up
    // with the persona dir appearing twice.
    const personasDir = join(testDir, 'personas');
    await mkdir(personasDir, { recursive: true });
    await createPersona(personasDir, 'ada');

    const adaSkillsDir = join(personasDir, 'ada', 'skills');
    await mkdir(adaSkillsDir, { recursive: true });
    await createSkillDir(adaSkillsDir, 'ada-skill');

    // Scenario 1: raw tier comes from getSkillDirectories (no workDir known).
    const rawNoWorkDir = simulateGetSubagentHostSkillDirs({ workDir: undefined });
    expect(rawNoWorkDir).not.toContain(adaSkillsDir);
    expect(rawNoWorkDir.some((d) => d.includes('/ada/skills'))).toBe(false);

    // Scenario 2: raw tier is explicitly passed via state.skillDirs (common in embedder integration).
    const someEmbedderDir = join(testDir, 'embedder-skills');
    await mkdir(someEmbedderDir, { recursive: true });
    await createSkillDir(someEmbedderDir, 'embedder-skill');

    const rawFromState = simulateGetSubagentHostSkillDirs({
      stateDotSkillDirs: [someEmbedderDir],
    });
    expect(rawFromState).toEqual([someEmbedderDir]);
    expect(rawFromState).not.toContain(adaSkillsDir);

    // Confirm: after child re-composes, the persona dir is added exactly once.
    const personaRegistry = new PersonaRegistry({
      bundledPersonasPath: join(testDir, 'nonexistent-bundled'),
      userPersonasPaths: [personasDir],
    });

    const adaPersonaSkillsDir = personaRegistry.personaSkillsDir('ada');
    const childDirs = composeSkillDirs({ skillDirs: rawFromState }, adaPersonaSkillsDir, {
      coreDir: undefined,
    });

    const occurrences = childDirs.filter((d) => d === adaSkillsDir).length;
    expect(occurrences).toBe(1);
  });
});
