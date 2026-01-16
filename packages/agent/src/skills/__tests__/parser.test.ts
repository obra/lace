// ABOUTME: Tests for SKILL.md frontmatter parsing

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { createTestTempDir } from '@lace/agent/test-utils';
import { parseSkillMd, findSkillMd, readSkillFromDir, SkillParseError } from '../parser';

describe('findSkillMd', () => {
  const tempDir = createTestTempDir('skill-find-test-');
  let testDir: string;

  beforeEach(async () => {
    testDir = await tempDir.getPath();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  it('finds SKILL.md (uppercase)', async () => {
    await writeFile(join(testDir, 'SKILL.md'), '---\nname: test\n---');
    expect(findSkillMd(testDir)).toBe(join(testDir, 'SKILL.md'));
  });

  it('finds skill.md (lowercase) as fallback', async () => {
    await writeFile(join(testDir, 'skill.md'), '---\nname: test\n---');
    const result = findSkillMd(testDir);
    // On case-insensitive filesystems (macOS), existsSync('SKILL.md') returns true
    // even if the file is named 'skill.md', so we may get either path back.
    // The important behavior is that we find a SKILL.md file when it exists.
    expect(result).not.toBeNull();
    expect(result!.toLowerCase()).toBe(join(testDir, 'skill.md').toLowerCase());
  });

  it('prefers SKILL.md over skill.md', async () => {
    await writeFile(join(testDir, 'SKILL.md'), '---\nname: upper\n---');
    await writeFile(join(testDir, 'skill.md'), '---\nname: lower\n---');
    expect(findSkillMd(testDir)).toBe(join(testDir, 'SKILL.md'));
  });

  it('returns null when no SKILL.md exists', () => {
    expect(findSkillMd(testDir)).toBeNull();
  });
});

describe('parseSkillMd', () => {
  it('parses valid frontmatter and body', () => {
    const content = `---
name: pdf-processing
description: Extract text from PDFs
---

# PDF Processing

Instructions here.`;

    const result = parseSkillMd(content);
    expect(result.properties.name).toBe('pdf-processing');
    expect(result.properties.description).toBe('Extract text from PDFs');
    expect(result.body).toContain('# PDF Processing');
    expect(result.body).toContain('Instructions here.');
  });

  it('parses optional fields (license, compatibility, metadata)', () => {
    const content = `---
name: test-skill
description: A test skill
license: MIT
compatibility: Requires git
metadata:
  author: test-org
  version: "1.0"
---

Body content.`;

    const result = parseSkillMd(content);
    expect(result.properties.license).toBe('MIT');
    expect(result.properties.compatibility).toBe('Requires git');
    expect(result.properties.metadata).toEqual({
      author: 'test-org',
      version: '1.0',
    });
  });

  it('throws on missing frontmatter', () => {
    expect(() => parseSkillMd('No frontmatter here')).toThrow('must start with');
  });

  it('throws on missing name', () => {
    const content = `---
description: Missing name
---
Body`;
    expect(() => parseSkillMd(content)).toThrow('name');
  });

  it('throws on missing description', () => {
    const content = `---
name: test
---
Body`;
    expect(() => parseSkillMd(content)).toThrow('description');
  });

  it('throws on invalid name format', () => {
    const content = `---
name: Invalid-Name
description: Has uppercase
---
Body`;
    expect(() => parseSkillMd(content)).toThrow('lowercase');
  });

  it('trims whitespace from body content', () => {
    const content = `---
name: test-skill
description: A test skill
---

  Body with whitespace

`;

    const result = parseSkillMd(content);
    expect(result.body).toBe('Body with whitespace');
  });

  it('throws SkillParseError with appropriate message', () => {
    try {
      parseSkillMd('No frontmatter');
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(SkillParseError);
      expect((error as SkillParseError).name).toBe('SkillParseError');
    }
  });

  it('throws when description exceeds 1024 characters', () => {
    const longDesc = 'a'.repeat(1025);
    const content = `---
name: test-skill
description: ${longDesc}
---

Body`;
    expect(() => parseSkillMd(content)).toThrow('1024');
  });

  it('throws when name exceeds 64 characters', () => {
    const longName = 'a'.repeat(65);
    const content = `---
name: ${longName}
description: Valid description
---

Body`;
    expect(() => parseSkillMd(content)).toThrow('64');
  });

  it('returns empty string for body when no content after frontmatter', () => {
    const content = `---
name: test-skill
description: Test description
---`;
    const result = parseSkillMd(content);
    expect(result.body).toBe('');
  });
});

describe('readSkillFromDir', () => {
  const tempDir = createTestTempDir('skill-read-test-');
  let testDir: string;

  beforeEach(async () => {
    testDir = await tempDir.getPath();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  it('reads and parses skill from directory', async () => {
    const skillDir = join(testDir, 'my-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      `---
name: my-skill
description: My test skill
---

# My Skill

Do the thing.`
    );

    const result = readSkillFromDir(skillDir);
    expect(result.properties.name).toBe('my-skill');
    expect(result.properties.description).toBe('My test skill');
    expect(result.body).toContain('# My Skill');
  });

  it('throws when no SKILL.md exists', () => {
    expect(() => readSkillFromDir(testDir)).toThrow('No SKILL.md found');
  });
});
