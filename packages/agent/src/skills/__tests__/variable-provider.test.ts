// ABOUTME: Tests for SkillVariableProvider - generates available_skills XML for system prompt injection

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { createTestTempDir } from '@lace/agent/test-utils';
import { SkillRegistry } from '../registry';
import { SkillVariableProvider } from '../variable-provider';

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

describe('SkillVariableProvider', () => {
  const tempDir = createTestTempDir('skill-variable-provider-test-');
  let testDir: string;

  beforeEach(async () => {
    testDir = await tempDir.getPath();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  it('generates available_skills XML', async () => {
    const skillsDir = join(testDir, 'skills');
    await mkdir(skillsDir, { recursive: true });
    await createSkillDir(skillsDir, 'commit', {
      description: 'Create git commits',
    });
    await createSkillDir(skillsDir, 'review-pr', {
      description: 'Review pull requests',
    });

    const registry = new SkillRegistry({ skillDirs: [skillsDir] });
    const provider = new SkillVariableProvider(registry);
    const variables = provider.getVariables();

    expect(variables).toHaveProperty('availableSkills');
    const xml = variables.availableSkills as string;

    // Verify XML structure
    expect(xml).toContain('<available_skills>');
    expect(xml).toContain('</available_skills>');
    expect(xml).toContain('<skill>');
    expect(xml).toContain('</skill>');

    // Verify skill data is present
    expect(xml).toContain('<name>commit</name>');
    expect(xml).toContain('<description>Create git commits</description>');
    expect(xml).toContain('<name>review-pr</name>');
    expect(xml).toContain('<description>Review pull requests</description>');
  });

  it('returns empty block when no skills', async () => {
    const skillsDir = join(testDir, 'empty-skills');
    await mkdir(skillsDir, { recursive: true });

    const registry = new SkillRegistry({ skillDirs: [skillsDir] });
    const provider = new SkillVariableProvider(registry);
    const variables = provider.getVariables();

    expect(variables).toHaveProperty('availableSkills');
    const xml = variables.availableSkills as string;

    expect(xml).toBe('<available_skills>\n</available_skills>');
  });

  it('escapes HTML entities in name and description', async () => {
    const skillsDir = join(testDir, 'skills');
    await mkdir(skillsDir, { recursive: true });

    // Create a skill with special characters in description
    // Note: Name must be kebab-case so it can't have <>&"' characters,
    // but description can have them
    const skillDir = join(skillsDir, 'special-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      `---
name: special-skill
description: Handles <html> tags & "quotes" and 'apostrophes'
---

Body content.`
    );

    const registry = new SkillRegistry({ skillDirs: [skillsDir] });
    const provider = new SkillVariableProvider(registry);
    const variables = provider.getVariables();

    const xml = variables.availableSkills as string;

    // Verify HTML entities are escaped
    expect(xml).toContain('&lt;html&gt;'); // < and > escaped
    expect(xml).toContain('&amp;'); // & escaped
    expect(xml).toContain('&quot;quotes&quot;'); // " escaped
    expect(xml).toContain('&#39;apostrophes&#39;'); // ' escaped

    // Should not contain unescaped special characters in the description
    expect(xml).not.toMatch(/<description>.*<html>.*<\/description>/);
    expect(xml).not.toMatch(/<description>.*[^&]".*<\/description>/);
  });
});
