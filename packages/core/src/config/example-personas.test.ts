import { describe, it, expect } from 'vitest';
import { PromptManager } from './prompt-manager';
import { personaRegistry } from './persona-registry';

describe('Example Personas', () => {
  it('loads all example personas without error', async () => {
    const personas = personaRegistry.listAvailablePersonas();
    const builtInPersonas = personas.filter((p) => !p.isUserDefined);

    // Should have at least lace, coder, and internal personas
    expect(builtInPersonas.length).toBeGreaterThanOrEqual(2);

    const personaNames = builtInPersonas.map((p) => p.name);
    expect(personaNames).toContain('lace');
    expect(personaNames).toContain('coder');
    // Internal personas with underscore prefix
    expect(personaNames).toContain('_helper-agent');
    expect(personaNames).toContain('_session-summary');
  });

  it('all personas are discoverable by registry', () => {
    expect(personaRegistry.hasPersona('lace')).toBe(true);
    expect(personaRegistry.hasPersona('coder')).toBe(true);
    expect(personaRegistry.hasPersona('_helper-agent')).toBe(true);
    expect(personaRegistry.hasPersona('_session-summary')).toBe(true);
  });

  it('all personas have valid file paths', () => {
    const personas = ['lace', 'coder', '_helper-agent', '_session-summary'];

    for (const persona of personas) {
      const path = personaRegistry.getPersonaPath(persona);
      expect(path).toBeTruthy();
      expect(path).toContain(`${persona}.md`);
    }
  });

  it('generates valid prompts for all example personas', async () => {
    const promptManager = new PromptManager({});
    const personas = ['lace', 'coder'];

    for (const persona of personas) {
      const prompt = await promptManager.generateSystemPrompt(persona);

      expect(prompt).toBeTruthy();
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(50); // Should be non-empty
      // Note: May fallback to default if template processing fails
    }
  });

  it('persona prompt generation does not throw errors', async () => {
    const promptManager = new PromptManager({});

    // Should not throw, even if falling back to default
    await expect(promptManager.generateSystemPrompt('coder')).resolves.toBeTruthy();
    await expect(promptManager.generateSystemPrompt('lace')).resolves.toBeTruthy();
    // Internal personas
    await expect(promptManager.generateSystemPrompt('_helper-agent')).resolves.toBeTruthy();
    await expect(promptManager.generateSystemPrompt('_session-summary')).resolves.toBeTruthy();
  });

  it('lace persona loads successfully', async () => {
    const promptManager = new PromptManager({});
    const prompt = await promptManager.generateSystemPrompt('lace');

    expect(prompt).toBeTruthy();
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(50);
  });

  it('personas are sorted alphabetically', () => {
    const personas = personaRegistry.listAvailablePersonas();
    const names = personas.map((p) => p.name);
    const sortedNames = [...names].sort();

    expect(names).toEqual(sortedNames);
  });

  it('built-in personas are marked correctly', () => {
    const personas = personaRegistry.listAvailablePersonas();
    const builtInPersonas = personas.filter((p) => !p.isUserDefined);

    expect(builtInPersonas.length).toBeGreaterThanOrEqual(3);

    for (const persona of builtInPersonas) {
      expect(persona.isUserDefined).toBe(false);
      expect(persona.path).toMatch(/.*\.md$/); // Should be logical path ending in .md
    }
  });

  it('personas validate correctly', () => {
    // Should not throw for valid personas
    expect(() => personaRegistry.validatePersona('lace')).not.toThrow();
    expect(() => personaRegistry.validatePersona('coder')).not.toThrow();
    expect(() => personaRegistry.validatePersona('_helper-agent')).not.toThrow();
    expect(() => personaRegistry.validatePersona('_session-summary')).not.toThrow();

    // Should throw for invalid persona
    expect(() => personaRegistry.validatePersona('nonexistent')).toThrow();
  });
});
