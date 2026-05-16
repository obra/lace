// ABOUTME: Tests for PersonaRegistry.parsePersona (frontmatter + body extraction)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { mkdirSync, writeFileSync, rmSync } from 'fs';

describe('PersonaRegistry.parsePersona', () => {
  let tempBundledDir: string;
  let tempUserDir: string;
  // Mocked-module import; typed via dynamic-import inference below.
  let PersonaRegistry: typeof import('../persona-registry').PersonaRegistry;
  let registry: InstanceType<typeof PersonaRegistry>;

  beforeEach(async () => {
    tempBundledDir = fs.mkdtempSync(path.join(tmpdir(), 'bundled-personas-'));
    tempUserDir = fs.mkdtempSync(path.join(tmpdir(), 'user-personas-'));

    // Mock lace dir to the scoped tempUserDir so user personas live at <tempUserDir>/agent-personas.
    vi.doMock('../lace-dir', () => ({
      getLaceDir: () => tempUserDir,
    }));

    vi.resetModules();
    ({ PersonaRegistry } = await import('../persona-registry'));
    registry = new PersonaRegistry(tempBundledDir);
  });

  afterEach(() => {
    rmSync(tempBundledDir, { recursive: true, force: true });
    rmSync(tempUserDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns empty config and full body when file has no frontmatter', () => {
    const body = 'You are a helpful assistant.\n\nBe concise.';
    writeFileSync(path.join(tempBundledDir, 'plain.md'), body);
    registry = new PersonaRegistry(tempBundledDir);

    const result = registry.parsePersona('plain');
    expect(result.config).toEqual({});
    expect(result.body).toBe(body);
  });

  it('parses valid frontmatter and returns body separately', () => {
    const content = `---
model: claude-sonnet-4
tools: [bash, file_read]
workspace: worktree
maxTurns: 20
---
You are Lace.`;
    writeFileSync(path.join(tempBundledDir, 'lace.md'), content);
    registry = new PersonaRegistry(tempBundledDir);

    const result = registry.parsePersona('lace');
    expect(result.config.model).toBe('claude-sonnet-4');
    expect(result.config.tools).toEqual(['bash', 'file_read']);
    expect(result.config.workspace).toBe('worktree');
    expect(result.config.maxTurns).toBe(20);
    expect(result.body.trim()).toBe('You are Lace.');
  });

  it('parses mcpServers block', () => {
    const content = `---
mcpServers:
  fs:
    command: npx
    args: ['-y', 'fs-mcp']
    enabled: true
---
Body here.`;
    writeFileSync(path.join(tempBundledDir, 'with-mcp.md'), content);
    registry = new PersonaRegistry(tempBundledDir);

    const result = registry.parsePersona('with-mcp');
    expect(result.config.mcpServers).toBeDefined();
    expect(result.config.mcpServers?.fs).toEqual({
      command: 'npx',
      args: ['-y', 'fs-mcp'],
      enabled: true,
    });
  });

  it('throws on invalid YAML', () => {
    const content = `---
model: : : not valid
  invalid: [unclosed
---
Body.`;
    writeFileSync(path.join(tempBundledDir, 'bad-yaml.md'), content);
    registry = new PersonaRegistry(tempBundledDir);

    expect(() => registry.parsePersona('bad-yaml')).toThrow(/yaml|parse/i);
  });

  it('throws on schema-mismatched frontmatter (invalid enum)', () => {
    const content = `---
workspace: invalid_value
---
Body.`;
    writeFileSync(path.join(tempBundledDir, 'bad-enum.md'), content);
    registry = new PersonaRegistry(tempBundledDir);

    expect(() => registry.parsePersona('bad-enum')).toThrow(/workspace/i);
  });

  it('throws on unknown top-level frontmatter key', () => {
    const content = `---
unknownField: oops
---
Body.`;
    writeFileSync(path.join(tempBundledDir, 'unknown-key.md'), content);
    registry = new PersonaRegistry(tempBundledDir);

    expect(() => registry.parsePersona('unknown-key')).toThrow(/unknown|unrecognized/i);
  });

  it('throws PersonaNotFoundError for unknown persona', () => {
    registry = new PersonaRegistry(tempBundledDir);
    expect(() => registry.parsePersona('does-not-exist')).toThrow(
      "Persona 'does-not-exist' not found"
    );
  });

  it('user persona overrides bundled when both exist', () => {
    writeFileSync(path.join(tempBundledDir, 'lace.md'), '---\nmodel: bundled\n---\nBundled body');
    const userPersonaDir = path.join(tempUserDir, 'agent-personas');
    mkdirSync(userPersonaDir, { recursive: true });
    writeFileSync(path.join(userPersonaDir, 'lace.md'), '---\nmodel: user-model\n---\nUser body');

    const result = registry.parsePersona('lace');
    expect(result.config.model).toBe('user-model');
    expect(result.body.trim()).toBe('User body');
  });
});
