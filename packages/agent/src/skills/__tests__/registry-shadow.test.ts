// ABOUTME: Tests that cross-source skill shadowing emits a warn-level log (Task 5.2)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { createTestTempDir } from '@lace/agent/test-utils';
import { SkillRegistry } from '../registry';
import { logger } from '@lace/agent/utils/logger';

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

describe('SkillRegistry cross-source shadow warning', () => {
  const tempDir = createTestTempDir('skill-registry-shadow-test-');
  let testDir: string;

  beforeEach(async () => {
    testDir = await tempDir.getPath();
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await tempDir.cleanup();
    vi.restoreAllMocks();
  });

  it('emits a warn when a later dir shadows a skill already registered from an earlier dir', async () => {
    const dirA = join(testDir, 'dirA');
    const dirB = join(testDir, 'dirB');
    await mkdir(dirA, { recursive: true });
    await mkdir(dirB, { recursive: true });

    await createSkillDir(dirA, 'my-skill', { description: 'Dir A version' });
    await createSkillDir(dirB, 'my-skill', { description: 'Dir B version' });

    const warnSpy = vi.spyOn(logger, 'warn');

    const registry = new SkillRegistry({ skillDirs: [dirA, dirB] });

    // (a) First dir wins: getSkill / getSkillContent resolve to dirA
    const skill = registry.getSkill('my-skill');
    expect(skill).not.toBeNull();
    expect(skill!.description).toBe('Dir A version');
    expect(skill!.skillDir).toBe(join(dirA, 'my-skill'));

    const content = registry.getSkillContent('my-skill');
    expect(content).not.toBeNull();
    expect(content!.skillDir).toBe(join(dirA, 'my-skill'));

    // (b) A warn-level log was emitted about the shadow
    expect(warnSpy).toHaveBeenCalled();
    const warnCall = warnSpy.mock.calls.find((call) => String(call[0]).includes('my-skill'));
    expect(warnCall).toBeDefined();
  });
});
