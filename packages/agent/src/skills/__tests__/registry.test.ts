// ABOUTME: Tests for SkillRegistry - discovers and manages skills from directories

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { createTestTempDir } from '@lace/agent/test-utils';
import { SkillRegistry } from '../registry';

/**
 * Helper to create a valid skill directory with SKILL.md
 */
async function createSkillDir(
  parentDir: string,
  skillName: string,
  options: { description?: string; body?: string } = {}
): Promise<string> {
  const skillDir = join(parentDir, skillName);
  await mkdir(skillDir, { recursive: true });
  const description = options.description ?? `Description for ${skillName}`;
  const body = options.body ?? `# ${skillName}\n\nInstructions for ${skillName}.`;
  await writeFile(
    join(skillDir, 'SKILL.md'),
    `---
name: ${skillName}
description: ${description}
---

${body}`
  );
  return skillDir;
}

describe('SkillRegistry', () => {
  const tempDir = createTestTempDir('skill-registry-test-');
  let testDir: string;

  beforeEach(async () => {
    testDir = await tempDir.getPath();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  it('discovers skills from a single directory', async () => {
    const skillsDir = join(testDir, 'skills');
    await mkdir(skillsDir, { recursive: true });
    await createSkillDir(skillsDir, 'pdf-processing');
    await createSkillDir(skillsDir, 'git-workflow');

    const registry = new SkillRegistry({ skillDirs: [skillsDir] });
    const skills = registry.listSkills();

    expect(skills).toHaveLength(2);
    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual(['git-workflow', 'pdf-processing']);
  });

  it('discovers skills from multiple directories', async () => {
    const dir1 = join(testDir, 'dir1');
    const dir2 = join(testDir, 'dir2');
    await mkdir(dir1, { recursive: true });
    await mkdir(dir2, { recursive: true });
    await createSkillDir(dir1, 'skill-a');
    await createSkillDir(dir2, 'skill-b');

    const registry = new SkillRegistry({ skillDirs: [dir1, dir2] });
    const skills = registry.listSkills();

    expect(skills).toHaveLength(2);
    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual(['skill-a', 'skill-b']);
  });

  it('earlier directories shadow later directories', async () => {
    const primaryDir = join(testDir, 'primary');
    const secondaryDir = join(testDir, 'secondary');
    await mkdir(primaryDir, { recursive: true });
    await mkdir(secondaryDir, { recursive: true });

    // Same skill name in both directories
    await createSkillDir(primaryDir, 'my-skill', {
      description: 'Primary version',
    });
    await createSkillDir(secondaryDir, 'my-skill', {
      description: 'Secondary version',
    });

    const registry = new SkillRegistry({
      skillDirs: [primaryDir, secondaryDir],
    });
    const skills = registry.listSkills();

    // Should only have one skill (primary shadows secondary)
    expect(skills).toHaveLength(1);
    expect(skills[0].description).toBe('Primary version');
    expect(skills[0].skillDir).toBe(join(primaryDir, 'my-skill'));
  });

  it('getSkill returns skill metadata by name', async () => {
    const skillsDir = join(testDir, 'skills');
    await mkdir(skillsDir, { recursive: true });
    await createSkillDir(skillsDir, 'my-skill', {
      description: 'My special skill',
    });

    const registry = new SkillRegistry({ skillDirs: [skillsDir] });
    const skill = registry.getSkill('my-skill');

    expect(skill).not.toBeNull();
    expect(skill!.name).toBe('my-skill');
    expect(skill!.description).toBe('My special skill');
    expect(skill!.skillDir).toBe(join(skillsDir, 'my-skill'));
    expect(skill!.skillMdPath).toBe(join(skillsDir, 'my-skill', 'SKILL.md'));
  });

  it('getSkill returns null for unknown skill', async () => {
    const skillsDir = join(testDir, 'skills');
    await mkdir(skillsDir, { recursive: true });
    await createSkillDir(skillsDir, 'existing-skill');

    const registry = new SkillRegistry({ skillDirs: [skillsDir] });
    const skill = registry.getSkill('non-existent-skill');

    expect(skill).toBeNull();
  });

  it('getSkillContent returns body content and path', async () => {
    const skillsDir = join(testDir, 'skills');
    await mkdir(skillsDir, { recursive: true });
    const expectedBody = '# PDF Processing\n\nUse this to process PDFs.';
    await createSkillDir(skillsDir, 'pdf-processing', {
      body: expectedBody,
    });

    const registry = new SkillRegistry({ skillDirs: [skillsDir] });
    const content = registry.getSkillContent('pdf-processing');

    expect(content).not.toBeNull();
    expect(content!.body).toBe(expectedBody);
    expect(content!.skillDir).toBe(join(skillsDir, 'pdf-processing'));
    expect(content!.skillMdPath).toBe(join(skillsDir, 'pdf-processing', 'SKILL.md'));
  });

  it('getSkillContent returns null for unknown skill', async () => {
    const skillsDir = join(testDir, 'skills');
    await mkdir(skillsDir, { recursive: true });

    const registry = new SkillRegistry({ skillDirs: [skillsDir] });
    const content = registry.getSkillContent('non-existent');

    expect(content).toBeNull();
  });

  it('skips directories without SKILL.md', async () => {
    const skillsDir = join(testDir, 'skills');
    await mkdir(skillsDir, { recursive: true });

    // Create a valid skill
    await createSkillDir(skillsDir, 'valid-skill');

    // Create a directory without SKILL.md
    const noSkillDir = join(skillsDir, 'not-a-skill');
    await mkdir(noSkillDir, { recursive: true });
    await writeFile(join(noSkillDir, 'README.md'), '# Not a skill');

    const registry = new SkillRegistry({ skillDirs: [skillsDir] });
    const skills = registry.listSkills();

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('valid-skill');
  });

  it('skips skills with invalid frontmatter', async () => {
    const skillsDir = join(testDir, 'skills');
    await mkdir(skillsDir, { recursive: true });

    // Create a valid skill
    await createSkillDir(skillsDir, 'valid-skill');

    // Create a skill with invalid frontmatter (missing description)
    const invalidDir = join(skillsDir, 'invalid-skill');
    await mkdir(invalidDir, { recursive: true });
    await writeFile(
      join(invalidDir, 'SKILL.md'),
      `---
name: invalid-skill
---

No description field.`
    );

    const registry = new SkillRegistry({ skillDirs: [skillsDir] });
    const skills = registry.listSkills();

    // Should only have the valid skill
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('valid-skill');
  });

  it('handles non-existent directories gracefully', async () => {
    const nonExistentDir = join(testDir, 'does-not-exist');
    const skillsDir = join(testDir, 'skills');
    await mkdir(skillsDir, { recursive: true });
    await createSkillDir(skillsDir, 'valid-skill');

    // Should not throw - just skip the non-existent directory
    const registry = new SkillRegistry({
      skillDirs: [nonExistentDir, skillsDir],
    });
    const skills = registry.listSkills();

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('valid-skill');
  });

  it('validates skill name matches directory name', async () => {
    const skillsDir = join(testDir, 'skills');
    await mkdir(skillsDir, { recursive: true });

    // Create a valid skill
    await createSkillDir(skillsDir, 'valid-skill');

    // Create a skill where name doesn't match directory
    const mismatchDir = join(skillsDir, 'dir-name');
    await mkdir(mismatchDir, { recursive: true });
    await writeFile(
      join(mismatchDir, 'SKILL.md'),
      `---
name: different-name
description: Name doesn't match directory
---

Body content.`
    );

    const registry = new SkillRegistry({ skillDirs: [skillsDir] });
    const skills = registry.listSkills();

    // Should only have the valid skill (mismatched name is skipped)
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('valid-skill');
  });

  describe('refresh', () => {
    it('reloads skills after directory changes', async () => {
      const skillsDir = join(testDir, 'skills');
      await mkdir(skillsDir, { recursive: true });
      await createSkillDir(skillsDir, 'skill-one');

      const registry = new SkillRegistry({ skillDirs: [skillsDir] });
      expect(registry.listSkills()).toHaveLength(1);

      // Add another skill
      await createSkillDir(skillsDir, 'skill-two');

      // Before refresh, still only one skill
      expect(registry.listSkills()).toHaveLength(1);

      // After refresh, both skills
      registry.refresh();
      expect(registry.listSkills()).toHaveLength(2);
    });
  });
});
