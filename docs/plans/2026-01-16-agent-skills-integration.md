# Agent Skills Integration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task.

**Goal:** Integrate support for Agent Skills (agentskills.io spec) into the Lace
agent, allowing skills to be discovered, listed in the system prompt, and
activated via a `use_skill` tool.

**Architecture:** Skills are discovered from 4 directories with precedence
(project-level shadows user-level, lace shadows claude). A
`SkillVariableProvider` injects `<available_skills>` XML into the system prompt
containing name + description. The `use_skill` tool returns the full SKILL.md
body content plus the skill's directory path for resource access.

**Tech Stack:** TypeScript, Zod for schema validation, YAML frontmatter parsing
(gray-matter or similar)

---

## Task 1: Add gray-matter dependency

**Files:**

- Modify: `packages/agent/package.json`

**Step 1: Add the dependency**

```bash
cd packages/agent && npm install gray-matter
```

**Step 2: Verify installation**

Run: `cd packages/agent && npm ls gray-matter` Expected: Shows gray-matter in
dependency tree

**Step 3: Commit**

```bash
git add packages/agent/package.json packages/agent/package-lock.json
git commit -m "chore: add gray-matter for YAML frontmatter parsing"
```

---

## Task 2: Create SkillProperties type and validation

**Files:**

- Create: `packages/agent/src/skills/types.ts`
- Create: `packages/agent/src/skills/types.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/agent/src/skills/types.test.ts
// ABOUTME: Tests for skill type definitions and validation

import { describe, it, expect } from 'vitest';
import {
  validateSkillName,
  validateSkillDescription,
  type SkillProperties,
} from './types';

describe('validateSkillName', () => {
  it('accepts valid kebab-case names', () => {
    expect(validateSkillName('pdf-processing')).toEqual({ valid: true });
    expect(validateSkillName('commit')).toEqual({ valid: true });
    expect(validateSkillName('code-review')).toEqual({ valid: true });
  });

  it('rejects uppercase characters', () => {
    const result = validateSkillName('PDF-Processing');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('lowercase');
  });

  it('rejects names starting with hyphen', () => {
    const result = validateSkillName('-pdf');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('start');
  });

  it('rejects names ending with hyphen', () => {
    const result = validateSkillName('pdf-');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('end');
  });

  it('rejects consecutive hyphens', () => {
    const result = validateSkillName('pdf--processing');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('consecutive');
  });

  it('rejects names over 64 characters', () => {
    const longName = 'a'.repeat(65);
    const result = validateSkillName(longName);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('64');
  });

  it('rejects empty names', () => {
    const result = validateSkillName('');
    expect(result.valid).toBe(false);
  });
});

describe('validateSkillDescription', () => {
  it('accepts valid descriptions', () => {
    expect(validateSkillDescription('Extract text from PDFs')).toEqual({
      valid: true,
    });
  });

  it('rejects empty descriptions', () => {
    const result = validateSkillDescription('');
    expect(result.valid).toBe(false);
  });

  it('rejects descriptions over 1024 characters', () => {
    const longDesc = 'a'.repeat(1025);
    const result = validateSkillDescription(longDesc);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('1024');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/agent && npx vitest run src/skills/types.test.ts` Expected:
FAIL - module not found

**Step 3: Write minimal implementation**

```typescript
// packages/agent/src/skills/types.ts
// ABOUTME: Type definitions and validation for Agent Skills

export interface SkillProperties {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
}

export interface SkillMetadata extends SkillProperties {
  /** Absolute path to the skill directory */
  skillDir: string;
  /** Absolute path to the SKILL.md file */
  skillMdPath: string;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;

export function validateSkillName(name: string): ValidationResult {
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return { valid: false, error: 'Skill name must be a non-empty string' };
  }

  const trimmed = name.trim();

  if (trimmed.length > MAX_NAME_LENGTH) {
    return {
      valid: false,
      error: `Skill name exceeds ${MAX_NAME_LENGTH} character limit`,
    };
  }

  if (trimmed !== trimmed.toLowerCase()) {
    return { valid: false, error: 'Skill name must be lowercase' };
  }

  if (trimmed.startsWith('-')) {
    return { valid: false, error: 'Skill name cannot start with a hyphen' };
  }

  if (trimmed.endsWith('-')) {
    return { valid: false, error: 'Skill name cannot end with a hyphen' };
  }

  if (trimmed.includes('--')) {
    return {
      valid: false,
      error: 'Skill name cannot contain consecutive hyphens',
    };
  }

  if (!/^[a-z0-9-]+$/.test(trimmed)) {
    return {
      valid: false,
      error:
        'Skill name can only contain lowercase letters, numbers, and hyphens',
    };
  }

  return { valid: true };
}

export function validateSkillDescription(
  description: string
): ValidationResult {
  if (
    !description ||
    typeof description !== 'string' ||
    description.trim().length === 0
  ) {
    return {
      valid: false,
      error: 'Skill description must be a non-empty string',
    };
  }

  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return {
      valid: false,
      error: `Skill description exceeds ${MAX_DESCRIPTION_LENGTH} character limit`,
    };
  }

  return { valid: true };
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/agent && npx vitest run src/skills/types.test.ts` Expected:
PASS

**Step 5: Commit**

```bash
git add packages/agent/src/skills/
git commit -m "feat(skills): add skill type definitions and validation"
```

---

## Task 3: Create skill parser

**Files:**

- Create: `packages/agent/src/skills/parser.ts`
- Create: `packages/agent/src/skills/parser.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/agent/src/skills/parser.test.ts
// ABOUTME: Tests for SKILL.md frontmatter parsing

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseSkillMd, findSkillMd } from './parser';

describe('findSkillMd', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('finds SKILL.md (uppercase)', () => {
    fs.writeFileSync(path.join(tempDir, 'SKILL.md'), '---\nname: test\n---');
    expect(findSkillMd(tempDir)).toBe(path.join(tempDir, 'SKILL.md'));
  });

  it('finds skill.md (lowercase) as fallback', () => {
    fs.writeFileSync(path.join(tempDir, 'skill.md'), '---\nname: test\n---');
    expect(findSkillMd(tempDir)).toBe(path.join(tempDir, 'skill.md'));
  });

  it('prefers SKILL.md over skill.md', () => {
    fs.writeFileSync(path.join(tempDir, 'SKILL.md'), '---\nname: upper\n---');
    fs.writeFileSync(path.join(tempDir, 'skill.md'), '---\nname: lower\n---');
    expect(findSkillMd(tempDir)).toBe(path.join(tempDir, 'SKILL.md'));
  });

  it('returns null when no SKILL.md exists', () => {
    expect(findSkillMd(tempDir)).toBeNull();
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

  it('parses optional fields', () => {
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
    expect(() => parseSkillMd('No frontmatter here')).toThrow(
      'must start with'
    );
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
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/agent && npx vitest run src/skills/parser.test.ts` Expected:
FAIL - module not found

**Step 3: Write minimal implementation**

```typescript
// packages/agent/src/skills/parser.ts
// ABOUTME: Parse SKILL.md files - extracts frontmatter and body content

import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';
import {
  validateSkillName,
  validateSkillDescription,
  type SkillProperties,
} from './types';

export interface ParsedSkill {
  properties: SkillProperties;
  body: string;
}

export class SkillParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillParseError';
  }
}

/**
 * Find the SKILL.md file in a skill directory.
 * Prefers SKILL.md (uppercase) but accepts skill.md (lowercase).
 */
export function findSkillMd(skillDir: string): string | null {
  for (const name of ['SKILL.md', 'skill.md']) {
    const filePath = path.join(skillDir, name);
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }
  return null;
}

/**
 * Parse SKILL.md content into properties and body.
 */
export function parseSkillMd(content: string): ParsedSkill {
  if (!content.startsWith('---')) {
    throw new SkillParseError(
      'SKILL.md must start with YAML frontmatter (---)'
    );
  }

  const parsed = matter(content);
  const data = parsed.data as Record<string, unknown>;

  // Validate required fields
  if (!data.name || typeof data.name !== 'string') {
    throw new SkillParseError('Missing required field: name');
  }

  if (!data.description || typeof data.description !== 'string') {
    throw new SkillParseError('Missing required field: description');
  }

  // Validate name format
  const nameValidation = validateSkillName(data.name);
  if (!nameValidation.valid) {
    throw new SkillParseError(`Invalid skill name: ${nameValidation.error}`);
  }

  // Validate description format
  const descValidation = validateSkillDescription(data.description);
  if (!descValidation.valid) {
    throw new SkillParseError(
      `Invalid skill description: ${descValidation.error}`
    );
  }

  // Build properties object
  const properties: SkillProperties = {
    name: data.name.trim(),
    description: data.description.trim(),
  };

  if (data.license && typeof data.license === 'string') {
    properties.license = data.license;
  }

  if (data.compatibility && typeof data.compatibility === 'string') {
    properties.compatibility = data.compatibility;
  }

  if (
    data.metadata &&
    typeof data.metadata === 'object' &&
    data.metadata !== null
  ) {
    properties.metadata = Object.fromEntries(
      Object.entries(data.metadata as Record<string, unknown>).map(([k, v]) => [
        k,
        String(v),
      ])
    );
  }

  return {
    properties,
    body: parsed.content.trim(),
  };
}

/**
 * Read and parse a skill from a directory.
 */
export function readSkillFromDir(skillDir: string): ParsedSkill {
  const skillMdPath = findSkillMd(skillDir);
  if (!skillMdPath) {
    throw new SkillParseError(`No SKILL.md found in ${skillDir}`);
  }

  const content = fs.readFileSync(skillMdPath, 'utf-8');
  return parseSkillMd(content);
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/agent && npx vitest run src/skills/parser.test.ts` Expected:
PASS

**Step 5: Commit**

```bash
git add packages/agent/src/skills/
git commit -m "feat(skills): add SKILL.md parser with frontmatter extraction"
```

---

## Task 4: Create SkillRegistry

**Files:**

- Create: `packages/agent/src/skills/registry.ts`
- Create: `packages/agent/src/skills/registry.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/agent/src/skills/registry.test.ts
// ABOUTME: Tests for skill discovery and registry

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SkillRegistry } from './registry';

describe('SkillRegistry', () => {
  let tempDir: string;
  let laceSkillsDir: string;
  let claudeSkillsDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-registry-test-'));
    laceSkillsDir = path.join(tempDir, '.lace', 'skills');
    claudeSkillsDir = path.join(tempDir, '.claude', 'skills');
    fs.mkdirSync(laceSkillsDir, { recursive: true });
    fs.mkdirSync(claudeSkillsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createSkill(dir: string, name: string, description: string): void {
    const skillDir = path.join(dir, name);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${description}\n---\n\nInstructions for ${name}.`
    );
  }

  it('discovers skills from a single directory', () => {
    createSkill(laceSkillsDir, 'commit', 'Create git commits');

    const registry = new SkillRegistry({ skillDirs: [laceSkillsDir] });
    const skills = registry.listSkills();

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('commit');
    expect(skills[0].description).toBe('Create git commits');
  });

  it('discovers skills from multiple directories', () => {
    createSkill(laceSkillsDir, 'commit', 'Lace commit skill');
    createSkill(claudeSkillsDir, 'review', 'Claude review skill');

    const registry = new SkillRegistry({
      skillDirs: [laceSkillsDir, claudeSkillsDir],
    });
    const skills = registry.listSkills();

    expect(skills).toHaveLength(2);
    expect(skills.map((s) => s.name).sort()).toEqual(['commit', 'review']);
  });

  it('earlier directories shadow later directories (lace shadows claude)', () => {
    createSkill(laceSkillsDir, 'commit', 'Lace version');
    createSkill(claudeSkillsDir, 'commit', 'Claude version');

    // laceSkillsDir first = higher priority
    const registry = new SkillRegistry({
      skillDirs: [laceSkillsDir, claudeSkillsDir],
    });
    const skills = registry.listSkills();

    expect(skills).toHaveLength(1);
    expect(skills[0].description).toBe('Lace version');
  });

  it('getSkill returns skill metadata by name', () => {
    createSkill(laceSkillsDir, 'commit', 'Create commits');

    const registry = new SkillRegistry({ skillDirs: [laceSkillsDir] });
    const skill = registry.getSkill('commit');

    expect(skill).not.toBeNull();
    expect(skill?.name).toBe('commit');
    expect(skill?.skillDir).toBe(path.join(laceSkillsDir, 'commit'));
  });

  it('getSkill returns null for unknown skill', () => {
    const registry = new SkillRegistry({ skillDirs: [laceSkillsDir] });
    expect(registry.getSkill('nonexistent')).toBeNull();
  });

  it('getSkillContent returns body content and path', () => {
    createSkill(laceSkillsDir, 'commit', 'Create commits');

    const registry = new SkillRegistry({ skillDirs: [laceSkillsDir] });
    const content = registry.getSkillContent('commit');

    expect(content).not.toBeNull();
    expect(content?.body).toContain('Instructions for commit');
    expect(content?.skillDir).toBe(path.join(laceSkillsDir, 'commit'));
  });

  it('skips directories without SKILL.md', () => {
    fs.mkdirSync(path.join(laceSkillsDir, 'not-a-skill'));
    createSkill(laceSkillsDir, 'real-skill', 'A real skill');

    const registry = new SkillRegistry({ skillDirs: [laceSkillsDir] });
    const skills = registry.listSkills();

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('real-skill');
  });

  it('skips skills with invalid frontmatter', () => {
    // Create invalid skill (name doesn't match directory)
    const invalidDir = path.join(laceSkillsDir, 'my-skill');
    fs.mkdirSync(invalidDir);
    fs.writeFileSync(
      path.join(invalidDir, 'SKILL.md'),
      '---\nname: wrong-name\ndescription: Mismatched\n---\nBody'
    );

    createSkill(laceSkillsDir, 'valid-skill', 'Valid skill');

    const registry = new SkillRegistry({ skillDirs: [laceSkillsDir] });
    const skills = registry.listSkills();

    // Should only have the valid skill
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('valid-skill');
  });

  it('handles non-existent directories gracefully', () => {
    const registry = new SkillRegistry({
      skillDirs: ['/nonexistent/path', laceSkillsDir],
    });

    createSkill(laceSkillsDir, 'commit', 'A skill');
    // Force re-scan since we created skill after constructor
    const freshRegistry = new SkillRegistry({
      skillDirs: ['/nonexistent/path', laceSkillsDir],
    });

    expect(freshRegistry.listSkills()).toHaveLength(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/agent && npx vitest run src/skills/registry.test.ts` Expected:
FAIL - module not found

**Step 3: Write minimal implementation**

```typescript
// packages/agent/src/skills/registry.ts
// ABOUTME: Discovers and manages skills from configured directories

import * as fs from 'fs';
import * as path from 'path';
import { findSkillMd, parseSkillMd, readSkillFromDir } from './parser';
import type { SkillMetadata } from './types';
import { logger } from '@lace/agent/utils/logger';

export interface SkillRegistryOptions {
  /** Directories to scan for skills, in priority order (first wins) */
  skillDirs: string[];
}

export interface SkillContent {
  body: string;
  skillDir: string;
  skillMdPath: string;
}

export class SkillRegistry {
  private skills: Map<string, SkillMetadata> = new Map();
  private readonly skillDirs: string[];

  constructor(options: SkillRegistryOptions) {
    this.skillDirs = options.skillDirs;
    this.scan();
  }

  /**
   * Scan all skill directories and build the registry.
   * Earlier directories take precedence (shadow later ones).
   */
  private scan(): void {
    this.skills.clear();

    for (const skillsDir of this.skillDirs) {
      this.scanDirectory(skillsDir);
    }
  }

  private scanDirectory(skillsDir: string): void {
    if (!fs.existsSync(skillsDir)) {
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    } catch (error) {
      logger.warn('Failed to read skills directory', { skillsDir, error });
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const skillDir = path.join(skillsDir, entry.name);
      const skillMdPath = findSkillMd(skillDir);

      if (!skillMdPath) {
        continue;
      }

      try {
        const content = fs.readFileSync(skillMdPath, 'utf-8');
        const parsed = parseSkillMd(content);

        // Validate that skill name matches directory name
        if (parsed.properties.name !== entry.name) {
          logger.warn('Skill name does not match directory name', {
            skillDir,
            skillName: parsed.properties.name,
            dirName: entry.name,
          });
          continue;
        }

        // Only add if not already present (first directory wins)
        if (!this.skills.has(parsed.properties.name)) {
          this.skills.set(parsed.properties.name, {
            ...parsed.properties,
            skillDir,
            skillMdPath,
          });
        }
      } catch (error) {
        logger.warn('Failed to parse skill', {
          skillDir,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * List all discovered skills (metadata only).
   */
  listSkills(): SkillMetadata[] {
    return Array.from(this.skills.values());
  }

  /**
   * Get skill metadata by name.
   */
  getSkill(name: string): SkillMetadata | null {
    return this.skills.get(name) ?? null;
  }

  /**
   * Get skill content (body) and location by name.
   */
  getSkillContent(name: string): SkillContent | null {
    const skill = this.skills.get(name);
    if (!skill) {
      return null;
    }

    try {
      const parsed = readSkillFromDir(skill.skillDir);
      return {
        body: parsed.body,
        skillDir: skill.skillDir,
        skillMdPath: skill.skillMdPath,
      };
    } catch (error) {
      logger.error('Failed to read skill content', {
        name,
        skillDir: skill.skillDir,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Refresh the registry by re-scanning all directories.
   */
  refresh(): void {
    this.scan();
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/agent && npx vitest run src/skills/registry.test.ts` Expected:
PASS

**Step 5: Commit**

```bash
git add packages/agent/src/skills/
git commit -m "feat(skills): add SkillRegistry for skill discovery"
```

---

## Task 5: Create skill directory resolver

**Files:**

- Create: `packages/agent/src/skills/directories.ts`
- Create: `packages/agent/src/skills/directories.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/agent/src/skills/directories.test.ts
// ABOUTME: Tests for skill directory resolution

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import { getSkillDirectories } from './directories';

describe('getSkillDirectories', () => {
  const originalHome = process.env.HOME;

  beforeEach(() => {
    process.env.HOME = '/mock/home';
  });

  afterEach(() => {
    process.env.HOME = originalHome;
  });

  it('returns directories in correct precedence order', () => {
    const dirs = getSkillDirectories('/project/path');

    expect(dirs).toEqual([
      '/project/path/.lace/skills',
      '/project/path/.claude/skills',
      '/mock/home/.lace/skills',
      '/mock/home/.claude/skills',
    ]);
  });

  it('excludes project directories when projectDir is undefined', () => {
    const dirs = getSkillDirectories(undefined);

    expect(dirs).toEqual([
      '/mock/home/.lace/skills',
      '/mock/home/.claude/skills',
    ]);
  });

  it('excludes project directories when projectDir is empty', () => {
    const dirs = getSkillDirectories('');

    expect(dirs).toEqual([
      '/mock/home/.lace/skills',
      '/mock/home/.claude/skills',
    ]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/agent && npx vitest run src/skills/directories.test.ts`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

```typescript
// packages/agent/src/skills/directories.ts
// ABOUTME: Resolves skill directory paths with proper precedence

import * as os from 'os';
import * as path from 'path';

/**
 * Get the list of skill directories to scan, in precedence order.
 *
 * Order (highest to lowest priority):
 * 1. <project>/.lace/skills/ - Project-level lace skills
 * 2. <project>/.claude/skills/ - Project-level claude skills
 * 3. ~/.lace/skills/ - User-level lace skills
 * 4. ~/.claude/skills/ - User-level claude skills
 *
 * Lace directories shadow Claude directories at each level.
 */
export function getSkillDirectories(projectDir: string | undefined): string[] {
  const homeDir = os.homedir();
  const dirs: string[] = [];

  // Project-level directories (if project specified)
  if (projectDir && projectDir.trim().length > 0) {
    dirs.push(path.join(projectDir, '.lace', 'skills'));
    dirs.push(path.join(projectDir, '.claude', 'skills'));
  }

  // User-level directories
  dirs.push(path.join(homeDir, '.lace', 'skills'));
  dirs.push(path.join(homeDir, '.claude', 'skills'));

  return dirs;
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/agent && npx vitest run src/skills/directories.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agent/src/skills/
git commit -m "feat(skills): add skill directory resolver with precedence"
```

---

## Task 6: Create index export for skills module

**Files:**

- Create: `packages/agent/src/skills/index.ts`

**Step 1: Create the exports file**

```typescript
// packages/agent/src/skills/index.ts
// ABOUTME: Public exports for the skills module

export {
  SkillRegistry,
  type SkillRegistryOptions,
  type SkillContent,
} from './registry';
export { getSkillDirectories } from './directories';
export type { SkillProperties, SkillMetadata, ValidationResult } from './types';
export { validateSkillName, validateSkillDescription } from './types';
export {
  parseSkillMd,
  findSkillMd,
  readSkillFromDir,
  SkillParseError,
} from './parser';
```

**Step 2: Verify exports compile**

Run: `cd packages/agent && npx tsc --noEmit` Expected: No errors

**Step 3: Commit**

```bash
git add packages/agent/src/skills/index.ts
git commit -m "feat(skills): add module index exports"
```

---

## Task 7: Create SkillVariableProvider

**Files:**

- Create: `packages/agent/src/skills/variable-provider.ts`
- Create: `packages/agent/src/skills/variable-provider.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/agent/src/skills/variable-provider.test.ts
// ABOUTME: Tests for skill variable provider (system prompt injection)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SkillVariableProvider } from './variable-provider';
import { SkillRegistry } from './registry';

describe('SkillVariableProvider', () => {
  let tempDir: string;
  let skillsDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-provider-test-'));
    skillsDir = path.join(tempDir, 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createSkill(name: string, description: string): void {
    const skillDir = path.join(skillsDir, name);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${description}\n---\n\nBody content.`
    );
  }

  it('generates available_skills XML', () => {
    createSkill('commit', 'Create git commits');
    createSkill('review', 'Review code changes');

    const registry = new SkillRegistry({ skillDirs: [skillsDir] });
    const provider = new SkillVariableProvider(registry);
    const variables = provider.getVariables();

    expect(variables.availableSkills).toBeDefined();
    const xml = variables.availableSkills as string;

    expect(xml).toContain('<available_skills>');
    expect(xml).toContain('</available_skills>');
    expect(xml).toContain('<skill>');
    expect(xml).toContain('<name>commit</name>');
    expect(xml).toContain('<description>Create git commits</description>');
    expect(xml).toContain('<name>review</name>');
    expect(xml).toContain('<description>Review code changes</description>');
  });

  it('returns empty block when no skills', () => {
    const registry = new SkillRegistry({ skillDirs: [skillsDir] });
    const provider = new SkillVariableProvider(registry);
    const variables = provider.getVariables();

    expect(variables.availableSkills).toBe(
      '<available_skills>\n</available_skills>'
    );
  });

  it('escapes HTML entities in name and description', () => {
    createSkill('test-skill', 'Handles <special> & "characters"');

    const registry = new SkillRegistry({ skillDirs: [skillsDir] });
    const provider = new SkillVariableProvider(registry);
    const variables = provider.getVariables();

    const xml = variables.availableSkills as string;
    expect(xml).toContain('&lt;special&gt;');
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&quot;characters&quot;');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/agent && npx vitest run src/skills/variable-provider.test.ts`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

```typescript
// packages/agent/src/skills/variable-provider.ts
// ABOUTME: Variable provider that injects available skills into system prompt

import type { SkillRegistry } from './registry';

/**
 * Escape HTML special characters for safe XML embedding.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Variable provider that generates <available_skills> XML for the system prompt.
 * Implements the VariableProvider interface from variable-providers.ts.
 */
export class SkillVariableProvider {
  constructor(private readonly registry: SkillRegistry) {}

  getVariables(): Record<string, unknown> {
    const skills = this.registry.listSkills();

    if (skills.length === 0) {
      return { availableSkills: '<available_skills>\n</available_skills>' };
    }

    const lines: string[] = ['<available_skills>'];

    for (const skill of skills) {
      lines.push('<skill>');
      lines.push(`<name>${escapeXml(skill.name)}</name>`);
      lines.push(`<description>${escapeXml(skill.description)}</description>`);
      lines.push('</skill>');
    }

    lines.push('</available_skills>');

    return { availableSkills: lines.join('\n') };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/agent && npx vitest run src/skills/variable-provider.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agent/src/skills/
git commit -m "feat(skills): add SkillVariableProvider for system prompt injection"
```

---

## Task 8: Create UseSkillTool

**Files:**

- Create: `packages/agent/src/tools/implementations/use-skill-tool.ts`
- Create: `packages/agent/src/tools/implementations/use-skill-tool.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/agent/src/tools/implementations/use-skill-tool.test.ts
// ABOUTME: Tests for the use_skill tool

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { UseSkillTool } from './use-skill-tool';
import { SkillRegistry } from '@lace/agent/skills';

describe('UseSkillTool', () => {
  let tempDir: string;
  let skillsDir: string;
  let registry: SkillRegistry;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'use-skill-test-'));
    skillsDir = path.join(tempDir, 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createSkill(name: string, description: string, body: string): void {
    const skillDir = path.join(skillsDir, name);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`
    );
  }

  it('returns skill content and location', async () => {
    createSkill(
      'commit',
      'Create git commits',
      '# Commit Skill\n\nFollow these steps...'
    );
    registry = new SkillRegistry({ skillDirs: [skillsDir] });
    const tool = new UseSkillTool(registry);

    const result = await tool.execute(
      { skill: 'commit' },
      { signal: new AbortController().signal }
    );

    expect(result.status).toBe('completed');
    const text = result.content[0];
    expect(text.type).toBe('text');
    expect((text as { type: 'text'; text: string }).text).toContain(
      'Skill: commit'
    );
    expect((text as { type: 'text'; text: string }).text).toContain(
      `Location: ${path.join(skillsDir, 'commit')}`
    );
    expect((text as { type: 'text'; text: string }).text).toContain(
      '# Commit Skill'
    );
    expect((text as { type: 'text'; text: string }).text).toContain(
      'Follow these steps...'
    );
  });

  it('returns error for unknown skill', async () => {
    registry = new SkillRegistry({ skillDirs: [skillsDir] });
    const tool = new UseSkillTool(registry);

    const result = await tool.execute(
      { skill: 'nonexistent' },
      { signal: new AbortController().signal }
    );

    expect(result.status).toBe('failed');
    const text = result.content[0];
    expect((text as { type: 'text'; text: string }).text).toContain(
      'not found'
    );
  });

  it('has correct metadata', () => {
    registry = new SkillRegistry({ skillDirs: [skillsDir] });
    const tool = new UseSkillTool(registry);

    expect(tool.name).toBe('use_skill');
    expect(tool.description).toContain('skill');
    expect(tool.annotations?.readOnlyHint).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run:
`cd packages/agent && npx vitest run src/tools/implementations/use-skill-tool.test.ts`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

```typescript
// packages/agent/src/tools/implementations/use-skill-tool.ts
// ABOUTME: Tool to activate a skill and get its instructions

import { z } from 'zod';
import { Tool } from '../tool';
import type { ToolResult, ToolContext } from '../types';
import type { SkillRegistry } from '@lace/agent/skills';

const useSkillSchema = z.object({
  skill: z
    .string()
    .min(1, 'Skill name is required')
    .describe('Name of the skill to activate'),
});

export class UseSkillTool extends Tool {
  name = 'use_skill';
  description =
    'Activate a skill to get specialized instructions for a task. ' +
    'Skills provide expert guidance for specific workflows like committing code, reviewing PRs, etc. ' +
    'Use this when you see a relevant skill in your available skills list.';
  schema = useSkillSchema;
  annotations = {
    readOnlyHint: true,
    idempotentHint: true,
  };

  constructor(private readonly registry: SkillRegistry) {
    super();
  }

  protected async executeValidated(
    args: z.infer<typeof useSkillSchema>,
    _context: ToolContext
  ): Promise<ToolResult> {
    const { skill: skillName } = args;

    const content = this.registry.getSkillContent(skillName);
    if (!content) {
      return this.createError(
        `Skill '${skillName}' not found. Check available skills in your system prompt.`
      );
    }

    const output = [
      `Skill: ${skillName}`,
      `Location: ${content.skillDir}`,
      '',
      '---',
      '',
      content.body,
    ].join('\n');

    return this.createResult(output);
  }
}
```

**Step 4: Run test to verify it passes**

Run:
`cd packages/agent && npx vitest run src/tools/implementations/use-skill-tool.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agent/src/tools/implementations/
git commit -m "feat(skills): add use_skill tool for skill activation"
```

---

## Task 9: Integrate skills into ToolExecutor

**Files:**

- Modify: `packages/agent/src/tools/executor.ts`

**Step 1: Read the current executor.ts to understand integration points**

Find where `registerAllAvailableTools()` is defined and where tools are
instantiated.

**Step 2: Update ToolExecutor to accept SkillRegistry**

Add SkillRegistry as an optional constructor parameter and register
UseSkillTool:

```typescript
// In executor.ts constructor or registerAllAvailableTools:
import { UseSkillTool } from './implementations/use-skill-tool';
import type { SkillRegistry } from '@lace/agent/skills';

// Add to constructor or as method parameter:
registerAllAvailableTools(skillRegistry?: SkillRegistry): void {
  const tools = [
    // ... existing tools ...
  ];

  if (skillRegistry) {
    tools.push(new UseSkillTool(skillRegistry));
  }

  this.registerTools(tools);
}
```

**Step 3: Run existing executor tests**

Run: `cd packages/agent && npx vitest run src/tools/executor.test.ts` Expected:
PASS (no regressions)

**Step 4: Commit**

```bash
git add packages/agent/src/tools/executor.ts
git commit -m "feat(skills): integrate UseSkillTool into ToolExecutor"
```

---

## Task 10: Integrate skills into PromptManager

**Files:**

- Modify: `packages/agent/src/config/prompt-manager.ts`

**Step 1: Update PromptManager to accept SkillRegistry**

```typescript
// In PromptManagerOptions:
import { SkillVariableProvider } from '@lace/agent/skills/variable-provider';
import type { SkillRegistry } from '@lace/agent/skills';

interface PromptManagerOptions {
  // ... existing options ...
  skillRegistry?: SkillRegistry;
}

// In constructor:
if (options.skillRegistry) {
  this.variableManager.addProvider(
    new SkillVariableProvider(options.skillRegistry)
  );
}
```

**Step 2: Run existing prompt manager tests**

Run: `cd packages/agent && npx vitest run src/config/prompt-manager.test.ts`
Expected: PASS (no regressions)

**Step 3: Commit**

```bash
git add packages/agent/src/config/prompt-manager.ts
git commit -m "feat(skills): integrate SkillVariableProvider into PromptManager"
```

---

## Task 11: Add skills section to system prompt template

**Files:**

- Modify: `packages/agent/config/agent-personas/lace.md` (or appropriate
  template file)

**Step 1: Find where to add the skills section**

Look for the template structure and find appropriate location (likely near tools
section).

**Step 2: Add conditional skills section**

```markdown
{{#availableSkills}}

## Available Skills

The following skills are available. Use the `use_skill` tool to activate a skill
when it's relevant to your task.

{{{availableSkills}}} {{/availableSkills}}
```

**Step 3: Verify template renders correctly**

Run manual test or add test case for template rendering with skills.

**Step 4: Commit**

```bash
git add packages/agent/config/agent-personas/
git commit -m "feat(skills): add available skills section to system prompt template"
```

---

## Task 12: Wire up skills in server/session initialization

**Files:**

- Modify: Where ConversationRunner or session is initialized (likely
  `packages/agent/src/rpc/register-handlers.ts` or similar)

**Step 1: Find session/runner initialization**

Search for where PromptManager and ToolExecutor are instantiated.

**Step 2: Create SkillRegistry and pass to both**

```typescript
import { SkillRegistry, getSkillDirectories } from '@lace/agent/skills';

// In initialization:
const skillDirs = getSkillDirectories(projectDir);
const skillRegistry = new SkillRegistry({ skillDirs });

// Pass to PromptManager
const promptManager = new PromptManager({
  // ... existing options ...
  skillRegistry,
});

// Pass to ToolExecutor
toolExecutor.registerAllAvailableTools(skillRegistry);
```

**Step 3: Run integration tests**

Run: `cd packages/agent && npm test` Expected: PASS

**Step 4: Commit**

```bash
git add packages/agent/src/
git commit -m "feat(skills): wire up SkillRegistry in session initialization"
```

---

## Task 13: Add end-to-end test

**Files:**

- Create: `packages/agent/src/skills/integration.test.ts`

**Step 1: Write integration test**

```typescript
// packages/agent/src/skills/integration.test.ts
// ABOUTME: End-to-end test for skills integration

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SkillRegistry, getSkillDirectories } from './index';
import { SkillVariableProvider } from './variable-provider';
import { UseSkillTool } from '../tools/implementations/use-skill-tool';

describe('Skills Integration', () => {
  let tempDir: string;
  let projectDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-integration-'));
    projectDir = path.join(tempDir, 'project');
    fs.mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createSkill(
    baseDir: string,
    name: string,
    description: string,
    body: string
  ): void {
    const skillDir = path.join(baseDir, name);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`
    );
  }

  it('full workflow: discover skills, inject into prompt, activate skill', async () => {
    // Setup: Create skills in project directory
    const projectSkillsDir = path.join(projectDir, '.lace', 'skills');
    fs.mkdirSync(projectSkillsDir, { recursive: true });
    createSkill(
      projectSkillsDir,
      'commit',
      'Create well-structured commits',
      '# Commit Guide\n\n1. Stage changes\n2. Write message'
    );

    // 1. Create registry with project skills
    const registry = new SkillRegistry({ skillDirs: [projectSkillsDir] });

    // 2. Verify skill is discovered
    const skills = registry.listSkills();
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('commit');

    // 3. Generate system prompt XML
    const provider = new SkillVariableProvider(registry);
    const variables = provider.getVariables();
    const xml = variables.availableSkills as string;
    expect(xml).toContain('<name>commit</name>');
    expect(xml).toContain('Create well-structured commits');

    // 4. Activate skill via tool
    const tool = new UseSkillTool(registry);
    const result = await tool.execute(
      { skill: 'commit' },
      { signal: new AbortController().signal }
    );

    expect(result.status).toBe('completed');
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Skill: commit');
    expect(text).toContain('# Commit Guide');
    expect(text).toContain('1. Stage changes');
  });
});
```

**Step 2: Run the integration test**

Run: `cd packages/agent && npx vitest run src/skills/integration.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/agent/src/skills/
git commit -m "test(skills): add end-to-end integration test"
```

---

## Task 14: Update module exports

**Files:**

- Modify: `packages/agent/src/skills/index.ts`

**Step 1: Ensure all public APIs are exported**

```typescript
// packages/agent/src/skills/index.ts
// ABOUTME: Public exports for the skills module

export {
  SkillRegistry,
  type SkillRegistryOptions,
  type SkillContent,
} from './registry';
export { getSkillDirectories } from './directories';
export { SkillVariableProvider } from './variable-provider';
export type { SkillProperties, SkillMetadata, ValidationResult } from './types';
export { validateSkillName, validateSkillDescription } from './types';
export {
  parseSkillMd,
  findSkillMd,
  readSkillFromDir,
  SkillParseError,
} from './parser';
```

**Step 2: Verify exports**

Run: `cd packages/agent && npx tsc --noEmit` Expected: No errors

**Step 3: Commit**

```bash
git add packages/agent/src/skills/index.ts
git commit -m "feat(skills): finalize module exports"
```

---

## Verification

After all tasks are complete, verify the full integration:

1. **Unit tests pass:**

   ```bash
   cd packages/agent && npm test
   ```

2. **TypeScript compiles:**

   ```bash
   cd packages/agent && npx tsc --noEmit
   ```

3. **Manual test:** Create a test skill and verify it appears in the system
   prompt and can be activated:

   ```bash
   mkdir -p ~/.lace/skills/test-skill
   cat > ~/.lace/skills/test-skill/SKILL.md << 'EOF'
   ---
   name: test-skill
   description: A test skill to verify the integration works
   ---

   # Test Skill

   This skill is for testing. If you can read this, skills are working!
   EOF
   ```

   Then start the agent and verify:
   - System prompt contains `<available_skills>` with `test-skill`
   - `use_skill` tool with `skill: "test-skill"` returns the body content

4. **Clean up test skill:**
   ```bash
   rm -rf ~/.lace/skills/test-skill
   ```
