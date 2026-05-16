// ABOUTME: Tests for PersonaRegistry.parsePersona (frontmatter + body extraction)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { mkdirSync, writeFileSync, rmSync } from 'fs';

describe('PersonaRegistry.parsePersona', () => {
  let tempBundledDir: string;
  let tempUserDir: string;
  let userPersonaDir: string;
  let PersonaRegistry: typeof import('../persona-registry').PersonaRegistry;
  let registry: InstanceType<typeof PersonaRegistry>;

  beforeEach(async () => {
    tempBundledDir = fs.mkdtempSync(path.join(tmpdir(), 'bundled-personas-'));
    tempUserDir = fs.mkdtempSync(path.join(tmpdir(), 'user-personas-'));
    userPersonaDir = path.join(tempUserDir, 'agent-personas');

    vi.resetModules();
    ({ PersonaRegistry } = await import('../persona-registry'));
    registry = new PersonaRegistry({
      bundledPersonasPath: tempBundledDir,
      userPersonasPaths: [userPersonaDir],
    });
  });

  afterEach(() => {
    rmSync(tempBundledDir, { recursive: true, force: true });
    rmSync(tempUserDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function makeRegistry(
    userPersonasPaths: readonly string[]
  ): InstanceType<typeof PersonaRegistry> {
    return new PersonaRegistry({
      bundledPersonasPath: tempBundledDir,
      userPersonasPaths,
    });
  }

  it('returns empty config and full body when file has no frontmatter', () => {
    const body = 'You are a helpful assistant.\n\nBe concise.';
    writeFileSync(path.join(tempBundledDir, 'plain.md'), body);
    registry = makeRegistry([userPersonaDir]);

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
    registry = makeRegistry([userPersonaDir]);

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
    registry = makeRegistry([userPersonaDir]);

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
    registry = makeRegistry([userPersonaDir]);

    expect(() => registry.parsePersona('bad-yaml')).toThrow(/yaml|parse/i);
  });

  it('throws on schema-mismatched frontmatter (invalid enum)', () => {
    const content = `---
workspace: invalid_value
---
Body.`;
    writeFileSync(path.join(tempBundledDir, 'bad-enum.md'), content);
    registry = makeRegistry([userPersonaDir]);

    expect(() => registry.parsePersona('bad-enum')).toThrow(/workspace/i);
  });

  it('throws on unknown top-level frontmatter key', () => {
    const content = `---
unknownField: oops
---
Body.`;
    writeFileSync(path.join(tempBundledDir, 'unknown-key.md'), content);
    registry = makeRegistry([userPersonaDir]);

    expect(() => registry.parsePersona('unknown-key')).toThrow(/unknown|unrecognized/i);
  });

  it('throws PersonaNotFoundError for unknown persona', () => {
    registry = makeRegistry([userPersonaDir]);
    expect(() => registry.parsePersona('does-not-exist')).toThrow(
      "Persona 'does-not-exist' not found"
    );
  });

  it('user persona overrides bundled when both exist', () => {
    writeFileSync(path.join(tempBundledDir, 'lace.md'), '---\nmodel: bundled\n---\nBundled body');
    mkdirSync(userPersonaDir, { recursive: true });
    writeFileSync(path.join(userPersonaDir, 'lace.md'), '---\nmodel: user-model\n---\nUser body');

    const result = registry.parsePersona('lace');
    expect(result.config.model).toBe('user-model');
    expect(result.body.trim()).toBe('User body');
  });
});

describe('PersonaRegistry user search paths', () => {
  let tempBundledDir: string;
  let tempA: string;
  let tempB: string;
  let PersonaRegistry: typeof import('../persona-registry').PersonaRegistry;

  beforeEach(async () => {
    tempBundledDir = fs.mkdtempSync(path.join(tmpdir(), 'bundled-personas-'));
    tempA = fs.mkdtempSync(path.join(tmpdir(), 'user-personas-a-'));
    tempB = fs.mkdtempSync(path.join(tmpdir(), 'user-personas-b-'));

    vi.resetModules();
    ({ PersonaRegistry } = await import('../persona-registry'));
  });

  afterEach(() => {
    rmSync(tempBundledDir, { recursive: true, force: true });
    rmSync(tempA, { recursive: true, force: true });
    rmSync(tempB, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('empty userPersonasPaths: only bundled personas resolve', () => {
    writeFileSync(path.join(tempBundledDir, 'lace.md'), 'Bundled body');
    const registry = new PersonaRegistry({
      bundledPersonasPath: tempBundledDir,
      userPersonasPaths: [],
    });

    expect(registry.hasPersona('lace')).toBe(true);
    expect(registry.parsePersona('lace').body.trim()).toBe('Bundled body');
    expect(() => registry.parsePersona('not-there')).toThrow("Persona 'not-there' not found");
  });

  it('earlier path wins when multiple paths contain the same persona', () => {
    writeFileSync(path.join(tempA, 'librarian.md'), '---\nmodel: from-a\n---\nA body');
    writeFileSync(path.join(tempB, 'librarian.md'), '---\nmodel: from-b\n---\nB body');

    const registry = new PersonaRegistry({
      bundledPersonasPath: tempBundledDir,
      userPersonasPaths: [tempA, tempB],
    });

    const result = registry.parsePersona('librarian');
    expect(result.config.model).toBe('from-a');
    expect(result.body.trim()).toBe('A body');
  });

  it('later path is used when earlier paths lack the persona', () => {
    writeFileSync(path.join(tempB, 'librarian.md'), '---\nmodel: from-b\n---\nB body');

    const registry = new PersonaRegistry({
      bundledPersonasPath: tempBundledDir,
      userPersonasPaths: [tempA, tempB],
    });

    const result = registry.parsePersona('librarian');
    expect(result.config.model).toBe('from-b');
    expect(result.body.trim()).toBe('B body');
  });

  it('bundled persona is overridden by any user path containing it', () => {
    writeFileSync(path.join(tempBundledDir, 'lace.md'), '---\nmodel: bundled\n---\nBundled body');
    writeFileSync(path.join(tempB, 'lace.md'), '---\nmodel: user-b\n---\nUser-B body');

    const registry = new PersonaRegistry({
      bundledPersonasPath: tempBundledDir,
      userPersonasPaths: [tempA, tempB],
    });

    const result = registry.parsePersona('lace');
    expect(result.config.model).toBe('user-b');
    expect(result.body.trim()).toBe('User-B body');
  });

  it('persona present only in later path is not shadowed by unrelated files in earlier path', () => {
    writeFileSync(path.join(tempA, 'unrelated.md'), 'A unrelated');
    writeFileSync(path.join(tempB, 'librarian.md'), 'librarian body');

    const registry = new PersonaRegistry({
      bundledPersonasPath: tempBundledDir,
      userPersonasPaths: [tempA, tempB],
    });

    expect(registry.hasPersona('librarian')).toBe(true);
    expect(registry.parsePersona('librarian').body.trim()).toBe('librarian body');
    expect(registry.hasPersona('unrelated')).toBe(true);
  });

  it('falls back to bundled when no user path has the persona', () => {
    writeFileSync(path.join(tempBundledDir, 'lace.md'), 'Bundled body');
    writeFileSync(path.join(tempA, 'other.md'), 'other body');

    const registry = new PersonaRegistry({
      bundledPersonasPath: tempBundledDir,
      userPersonasPaths: [tempA, tempB],
    });

    expect(registry.parsePersona('lace').body.trim()).toBe('Bundled body');
  });

  it('listAvailablePersonas marks resolved-from-user as user-defined; bundled-only as not', () => {
    writeFileSync(path.join(tempBundledDir, 'only-bundled.md'), 'Bundled only');
    writeFileSync(path.join(tempBundledDir, 'lace.md'), 'Bundled lace');
    writeFileSync(path.join(tempA, 'lace.md'), 'User lace');

    const registry = new PersonaRegistry({
      bundledPersonasPath: tempBundledDir,
      userPersonasPaths: [tempA, tempB],
    });

    const personas = registry.listAvailablePersonas();
    const byName = new Map(personas.map((p) => [p.name, p]));

    expect(byName.get('lace')?.isUserDefined).toBe(true);
    expect(byName.get('lace')?.path).toContain(tempA);
    expect(byName.get('only-bundled')?.isUserDefined).toBe(false);
  });
});
