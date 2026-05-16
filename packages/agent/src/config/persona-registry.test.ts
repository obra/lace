import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PersonaRegistry } from './persona-registry';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { mkdirSync, writeFileSync, rmSync } from 'fs';

describe('PersonaRegistry', () => {
  let tempBundledDir: string;
  let tempUserDir: string;
  let userPersonaDir: string;
  let registry: PersonaRegistry;

  function makeRegistry(userPersonasPaths: readonly string[] = [userPersonaDir]): PersonaRegistry {
    return new PersonaRegistry({
      bundledPersonasPath: tempBundledDir,
      userPersonasPaths,
    });
  }

  beforeEach(() => {
    tempBundledDir = fs.mkdtempSync(path.join(tmpdir(), 'bundled-personas-'));
    tempUserDir = fs.mkdtempSync(path.join(tmpdir(), 'user-personas-'));
    userPersonaDir = path.join(tempUserDir, 'agent-personas');
    registry = makeRegistry();
  });

  afterEach(() => {
    rmSync(tempBundledDir, { recursive: true, force: true });
    rmSync(tempUserDir, { recursive: true, force: true });
  });

  it('loads bundled personas from directory', () => {
    writeFileSync(path.join(tempBundledDir, 'lace.md'), 'Default persona');
    writeFileSync(path.join(tempBundledDir, 'coding-agent.md'), 'Coding persona');

    registry = makeRegistry();

    const personas = registry.listAvailablePersonas();
    expect(personas).toHaveLength(2);
    expect(personas.map((p) => p.name)).toContain('lace');
    expect(personas.map((p) => p.name)).toContain('coding-agent');
    expect(personas.every((p) => !p.isUserDefined)).toBe(true);
  });

  it('user personas override built-in ones', () => {
    writeFileSync(path.join(tempBundledDir, 'lace.md'), 'Default persona');

    mkdirSync(userPersonaDir, { recursive: true });
    writeFileSync(path.join(userPersonaDir, 'lace.md'), 'User override');

    const personas = registry.listAvailablePersonas();
    const lacePersona = personas.find((p) => p.name === 'lace');

    expect(lacePersona?.isUserDefined).toBe(true);
    expect(lacePersona?.path).toContain('agent-personas');
  });

  it('validates persona existence', () => {
    writeFileSync(path.join(tempBundledDir, 'lace.md'), 'Default persona');
    registry = makeRegistry();

    expect(() => registry.validatePersona('lace')).not.toThrow();
    expect(() => registry.validatePersona('nonexistent')).toThrow(
      "Persona 'nonexistent' not found"
    );
  });

  it('error message lists available personas', () => {
    writeFileSync(path.join(tempBundledDir, 'lace.md'), 'Default');
    writeFileSync(path.join(tempBundledDir, 'coding-agent.md'), 'Coding');
    registry = makeRegistry();

    expect(() => registry.validatePersona('bad-name')).toThrow(
      'Available personas: coding-agent, lace'
    );
  });

  it('returns correct persona paths', () => {
    writeFileSync(path.join(tempBundledDir, 'lace.md'), 'Default persona');
    registry = makeRegistry();

    const path1 = registry.getPersonaPath('lace');
    expect(path1).toBe('lace.md'); // Built-in personas return logical path

    const path2 = registry.getPersonaPath('nonexistent');
    expect(path2).toBeNull();
  });

  it('hasPersona returns correct boolean values', () => {
    writeFileSync(path.join(tempBundledDir, 'lace.md'), 'Default persona');
    registry = makeRegistry();

    expect(registry.hasPersona('lace')).toBe(true);
    expect(registry.hasPersona('nonexistent')).toBe(false);
  });

  it('handles missing bundled directory gracefully', () => {
    const nonExistentDir = path.join(tmpdir(), 'does-not-exist');
    const registryWithBadPath = new PersonaRegistry({
      bundledPersonasPath: nonExistentDir,
      userPersonasPaths: [],
    });

    const personas = registryWithBadPath.listAvailablePersonas();
    expect(personas).toHaveLength(0);
    expect(registryWithBadPath.hasPersona('lace')).toBe(false);
  });

  it('ignores non-markdown files', () => {
    writeFileSync(path.join(tempBundledDir, 'lace.md'), 'Valid persona');
    writeFileSync(path.join(tempBundledDir, 'readme.txt'), 'Not a persona');
    writeFileSync(path.join(tempBundledDir, 'config.json'), '{}');

    registry = makeRegistry();

    const personas = registry.listAvailablePersonas();
    expect(personas).toHaveLength(1);
    expect(personas[0].name).toBe('lace');
  });
});
