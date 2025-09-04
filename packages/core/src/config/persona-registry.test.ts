import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PersonaRegistry } from './persona-registry';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { mkdirSync, writeFileSync, rmSync } from 'fs';

describe('PersonaRegistry', () => {
  let tempBundledDir: string;
  let tempUserDir: string;
  let registry: PersonaRegistry;
  let originalGetLaceDir: () => string;

  beforeEach(async () => {
    // Create temp directories for testing
    tempBundledDir = fs.mkdtempSync(path.join(tmpdir(), 'bundled-personas-'));
    tempUserDir = fs.mkdtempSync(path.join(tmpdir(), 'user-personas-'));
    
    // Mock getLaceDir to return our temp directory parent
    vi.doMock('~/config/lace-dir', () => ({
      getLaceDir: () => path.dirname(tempUserDir)
    }));

    // Re-import PersonaRegistry to get mocked version
    vi.resetModules();
    const { PersonaRegistry: MockedPersonaRegistry } = await import('./persona-registry');
    registry = new MockedPersonaRegistry(tempBundledDir);
  });

  afterEach(() => {
    rmSync(tempBundledDir, { recursive: true, force: true });
    rmSync(tempUserDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('loads bundled personas from directory', () => {
    // Create test personas
    writeFileSync(path.join(tempBundledDir, 'lace.md'), 'Default persona');
    writeFileSync(path.join(tempBundledDir, 'coding-agent.md'), 'Coding persona');
    
    // Create new registry to trigger loading
    registry = new PersonaRegistry(tempBundledDir);
    
    const personas = registry.listAvailablePersonas();
    expect(personas).toHaveLength(2);
    expect(personas.map(p => p.name)).toContain('lace');
    expect(personas.map(p => p.name)).toContain('coding-agent');
    expect(personas.every(p => !p.isUserDefined)).toBe(true);
  });

  it('user personas override built-in ones', async () => {
    // Create built-in personas
    writeFileSync(path.join(tempBundledDir, 'lace.md'), 'Default persona');
    
    // Create user override directory and file
    const userPersonaDir = path.join(path.dirname(tempUserDir), 'agent-personas');
    mkdirSync(userPersonaDir, { recursive: true });
    writeFileSync(path.join(userPersonaDir, 'lace.md'), 'User override');
    
    // Force registry to reload user personas by accessing them
    const personas = registry.listAvailablePersonas();
    const lacePersona = personas.find(p => p.name === 'lace');
    
    expect(lacePersona?.isUserDefined).toBe(true);
    expect(lacePersona?.path).toContain('agent-personas');
  });

  it('validates persona existence', () => {
    writeFileSync(path.join(tempBundledDir, 'lace.md'), 'Default persona');
    registry = new PersonaRegistry(tempBundledDir);
    
    expect(() => registry.validatePersona('lace')).not.toThrow();
    expect(() => registry.validatePersona('nonexistent')).toThrow('Persona \'nonexistent\' not found');
  });

  it('error message lists available personas', () => {
    writeFileSync(path.join(tempBundledDir, 'lace.md'), 'Default');
    writeFileSync(path.join(tempBundledDir, 'coding-agent.md'), 'Coding');
    registry = new PersonaRegistry(tempBundledDir);
    
    expect(() => registry.validatePersona('bad-name')).toThrow('Available personas: coding-agent, lace');
  });

  it('returns correct persona paths', () => {
    // Create built-in persona
    writeFileSync(path.join(tempBundledDir, 'lace.md'), 'Default persona');
    registry = new PersonaRegistry(tempBundledDir);
    
    const path1 = registry.getPersonaPath('lace');
    expect(path1).toContain('lace.md');
    expect(path1).toContain(tempBundledDir);
    
    // Test nonexistent persona
    const path2 = registry.getPersonaPath('nonexistent');
    expect(path2).toBeNull();
  });

  it('hasPersona returns correct boolean values', () => {
    writeFileSync(path.join(tempBundledDir, 'lace.md'), 'Default persona');
    registry = new PersonaRegistry(tempBundledDir);
    
    expect(registry.hasPersona('lace')).toBe(true);
    expect(registry.hasPersona('nonexistent')).toBe(false);
  });

  it('handles missing bundled directory gracefully', () => {
    const nonExistentDir = path.join(tmpdir(), 'does-not-exist');
    const registryWithBadPath = new PersonaRegistry(nonExistentDir);
    
    const personas = registryWithBadPath.listAvailablePersonas();
    expect(personas).toHaveLength(0);
    expect(registryWithBadPath.hasPersona('lace')).toBe(false);
  });

  it('ignores non-markdown files', () => {
    writeFileSync(path.join(tempBundledDir, 'lace.md'), 'Valid persona');
    writeFileSync(path.join(tempBundledDir, 'readme.txt'), 'Not a persona');
    writeFileSync(path.join(tempBundledDir, 'config.json'), '{}');
    
    registry = new PersonaRegistry(tempBundledDir);
    
    const personas = registry.listAvailablePersonas();
    expect(personas).toHaveLength(1);
    expect(personas[0].name).toBe('lace');
  });
});