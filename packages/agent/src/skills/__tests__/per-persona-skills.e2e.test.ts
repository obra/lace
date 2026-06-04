// ABOUTME: E2E test proving per-persona skills reach a SkillRegistry via composeSkillDirs.
// Verifies persona skill layer, persona isolation, and embedder skillDirs layering.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestTempDir } from '@lace/agent/test-utils';
import { PersonaRegistry } from '../../config/persona-registry';
import { composeSkillDirs } from '../compose-skill-dirs';
import { SkillRegistry } from '../registry';
import { resetContributedDirsForTest } from '@lace/agent/plugins';

/**
 * Writes a minimal valid persona .md file (no-frontmatter content is fine for
 * PersonaRegistry — it only needs the file to exist for discovery; resourceDir
 * is purely filesystem-based).
 */
async function createPersona(personasDir: string, name: string): Promise<void> {
  await writeFile(
    join(personasDir, `${name}.md`),
    `---\nname: ${name}\n---\n\nPersona body for ${name}.`
  );
}

/**
 * Creates a skill directory with a valid SKILL.md inside a parent skills dir.
 * The directory name must match the skill name (registry rule).
 */
async function createSkillDir(
  parentDir: string,
  skillName: string,
  description = `Description for ${skillName}`
): Promise<string> {
  const skillDir = join(parentDir, skillName);
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, 'SKILL.md'),
    `---\nname: ${skillName}\ndescription: ${description}\n---\n\n# ${skillName}\n\nInstructions.`
  );
  return skillDir;
}

describe('per-persona skills e2e', () => {
  const tempDir = createTestTempDir('per-persona-skills-e2e-');
  let testDir: string;

  beforeEach(async () => {
    testDir = await tempDir.getPath();
    // Reset plugin skill dirs so tests don't interfere with each other.
    resetContributedDirsForTest();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  it('persona skills are listed for that persona and not for a persona with no skills dir', async () => {
    // Set up a user personas dir with two personas: "ada" (has skills) and "scout" (no skills).
    const personasDir = join(testDir, 'personas');
    await mkdir(personasDir, { recursive: true });
    await createPersona(personasDir, 'ada');
    await createPersona(personasDir, 'scout');

    // Give "ada" a skills directory with one skill.
    const adaSkillsDir = join(personasDir, 'ada', 'skills');
    await mkdir(adaSkillsDir, { recursive: true });
    await createSkillDir(adaSkillsDir, 'ada-special-skill');

    const personaRegistry = new PersonaRegistry({
      bundledPersonasPath: join(testDir, 'nonexistent-bundled'), // no bundled personas needed
      userPersonasPaths: [personasDir],
    });

    // ada → gets its persona skills dir
    const adaSkillsDirs = composeSkillDirs(
      { skillDirs: [] },
      personaRegistry.personaSkillsDir('ada'),
      {}
    );
    const adaRegistry = new SkillRegistry({ skillDirs: adaSkillsDirs });
    expect(adaRegistry.listSkills().map((s) => s.name)).toContain('ada-special-skill');

    // scout → no skills dir; personaSkillsDir returns null
    expect(personaRegistry.personaSkillsDir('scout')).toBeNull();
    const scoutSkillsDirs = composeSkillDirs(
      { skillDirs: [] },
      personaRegistry.personaSkillsDir('scout'),
      {}
    );
    const scoutRegistry = new SkillRegistry({ skillDirs: scoutSkillsDirs });
    expect(scoutRegistry.listSkills()).toHaveLength(0);

    // Crucially, ada's skill is NOT visible when the persona is scout.
    expect(scoutRegistry.getSkill('ada-special-skill')).toBeNull();
  });

  it('embedder state.skillDirs still layers beneath persona and plugin skills (first-wins)', async () => {
    // Set up a persona with its own skill.
    const personasDir = join(testDir, 'personas');
    await mkdir(personasDir, { recursive: true });
    await createPersona(personasDir, 'ada');

    const adaSkillsDir = join(personasDir, 'ada', 'skills');
    await mkdir(adaSkillsDir, { recursive: true });
    await createSkillDir(adaSkillsDir, 'persona-skill');

    // Set up an embedder workDir skill.
    const embedderSkillsDir = join(testDir, 'embedder-skills');
    await mkdir(embedderSkillsDir, { recursive: true });
    await createSkillDir(embedderSkillsDir, 'embedder-skill');

    // Also add a skill in BOTH persona and embedder dirs to verify persona wins.
    await createSkillDir(adaSkillsDir, 'shared-skill', 'Persona version');
    await createSkillDir(embedderSkillsDir, 'shared-skill', 'Embedder version');

    const personaRegistry = new PersonaRegistry({
      bundledPersonasPath: join(testDir, 'nonexistent-bundled'),
      userPersonasPaths: [personasDir],
    });

    const skillDirs = composeSkillDirs(
      { skillDirs: [embedderSkillsDir] },
      personaRegistry.personaSkillsDir('ada'),
      {}
    );
    const registry = new SkillRegistry({ skillDirs: skillDirs });

    // Both persona and embedder skills are present.
    expect(registry.getSkill('persona-skill')).not.toBeNull();
    expect(registry.getSkill('embedder-skill')).not.toBeNull();

    // Persona (earlier in list) wins for shared-skill.
    const sharedSkill = registry.getSkill('shared-skill');
    expect(sharedSkill).not.toBeNull();
    expect(sharedSkill!.description).toBe('Persona version');
  });
});
