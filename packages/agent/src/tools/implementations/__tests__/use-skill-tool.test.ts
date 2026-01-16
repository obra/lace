// ABOUTME: Tests for the use_skill tool that activates skills and returns their content

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { UseSkillTool } from '../use-skill-tool';
import { SkillRegistry } from '@lace/agent/skills';

describe('UseSkillTool', () => {
  let tempDir: string;
  let skillsDir: string;
  let registry: SkillRegistry;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'use-skill-test-'));
    skillsDir = join(tempDir, 'skills');
    mkdirSync(skillsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function createSkill(name: string, description: string, body: string): void {
    const skillDir = join(skillsDir, name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`
    );
  }

  it('returns skill content and location for existing skill', async () => {
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
    expect(result.content).toHaveLength(1);
    const text = result.content[0];
    expect(text.type).toBe('text');
    const textContent = (text as { type: 'text'; text: string }).text;
    expect(textContent).toContain('Skill: commit');
    expect(textContent).toContain(`Location: ${join(skillsDir, 'commit')}`);
    expect(textContent).toContain('# Commit Skill');
    expect(textContent).toContain('Follow these steps...');
  });

  it('returns error for unknown skill', async () => {
    registry = new SkillRegistry({ skillDirs: [skillsDir] });
    const tool = new UseSkillTool(registry);

    const result = await tool.execute(
      { skill: 'nonexistent' },
      { signal: new AbortController().signal }
    );

    expect(result.status).toBe('failed');
    expect(result.content).toHaveLength(1);
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('not found');
    expect(text).toContain('nonexistent');
  });

  it('returns validation error for empty skill name', async () => {
    registry = new SkillRegistry({ skillDirs: [skillsDir] });
    const tool = new UseSkillTool(registry);

    const result = await tool.execute(
      { skill: '' },
      { signal: new AbortController().signal }
    );

    expect(result.status).toBe('failed');
    // Zod validation should catch this
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('skill');
  });

  it('has correct metadata', () => {
    registry = new SkillRegistry({ skillDirs: [skillsDir] });
    const tool = new UseSkillTool(registry);

    expect(tool.name).toBe('use_skill');
    expect(tool.description).toContain('skill');
    expect(tool.annotations?.readOnlyHint).toBe(true);
    expect(tool.annotations?.idempotentHint).toBe(true);
  });

  it('includes skill body exactly as written', async () => {
    const complexBody = `# Complex Skill

## Section 1

- Item one
- Item two

\`\`\`typescript
const x = 1;
\`\`\`

Some **markdown** content with *formatting*.`;

    createSkill('complex', 'A complex skill', complexBody);
    registry = new SkillRegistry({ skillDirs: [skillsDir] });
    const tool = new UseSkillTool(registry);

    const result = await tool.execute(
      { skill: 'complex' },
      { signal: new AbortController().signal }
    );

    expect(result.status).toBe('completed');
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('## Section 1');
    expect(text).toContain('- Item one');
    expect(text).toContain('const x = 1;');
    expect(text).toContain('Some **markdown** content');
  });
});
