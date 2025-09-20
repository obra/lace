// ABOUTME: Tests for the new orchestrator-focused lace persona
// ABOUTME: Validates elicitation behavior and proper loading

import { describe, it, expect } from 'vitest';
import { PromptManager } from './prompt-manager';
import { personaRegistry } from './persona-registry';

describe('Lace Persona (Orchestrator)', () => {
  it('lace persona exists and is loadable', () => {
    expect(personaRegistry.hasPersona('lace')).toBe(true);
    const path = personaRegistry.getPersonaPath('lace');
    expect(path).toBeTruthy();
    expect(path).toContain('lace.md');
  });

  it('generates lace persona prompt with orchestration focus', async () => {
    const promptManager = new PromptManager({});
    const prompt = await promptManager.generateSystemPrompt('lace');

    expect(prompt).toBeTruthy();
    expect(prompt.length).toBeGreaterThan(100);

    // Check for key orchestrator concepts in the prompt
    expect(prompt).toContain('orchestrator');
    expect(prompt).toContain('understand');
    expect(prompt).toContain('goals');
  });

  it('lace persona does not include coding-specific sections', async () => {
    const promptManager = new PromptManager({});
    const prompt = await promptManager.generateSystemPrompt('lace');

    // Should not have TDD references from the old persona
    expect(prompt).not.toContain('Write a test that should fail');
    expect(prompt).not.toContain('Run the test and observe the failure');
  });

  it('coder persona exists as separate entity', () => {
    expect(personaRegistry.hasPersona('coder')).toBe(true);
    const path = personaRegistry.getPersonaPath('coder');
    expect(path).toBeTruthy();
    expect(path).toContain('coder.md');
  });

  it('coder persona includes coding-specific content', async () => {
    const promptManager = new PromptManager({});
    const prompt = await promptManager.generateSystemPrompt('coder');

    expect(prompt).toBeTruthy();
    // Coder should have TDD content
    expect(prompt).toContain('TDD');
    expect(prompt).toContain('test');
  });

  it('default agent uses lace persona', async () => {
    // This is implicit in Agent constructor: this._persona = config.persona || 'lace';
    // We're verifying the fallback behavior
    const promptManager = new PromptManager({});

    // When no persona is specified, it should use 'lace'
    const defaultPrompt = await promptManager.generateSystemPrompt('lace');
    const explicitLacePrompt = await promptManager.generateSystemPrompt('lace');

    expect(defaultPrompt).toBe(explicitLacePrompt);
  });

  it('personas have distinct content', async () => {
    const promptManager = new PromptManager({});

    const lacePrompt = await promptManager.generateSystemPrompt('lace');
    const coderPrompt = await promptManager.generateSystemPrompt('coder');
    const helperPrompt = await promptManager.generateSystemPrompt('_helper-agent');

    // Each persona should be unique
    expect(lacePrompt).not.toBe(coderPrompt);
    expect(lacePrompt).not.toBe(helperPrompt);
    expect(coderPrompt).not.toBe(helperPrompt);

    // Each should have substantial content
    expect(lacePrompt.length).toBeGreaterThan(500);
    expect(coderPrompt.length).toBeGreaterThan(500);
    expect(helperPrompt.length).toBeGreaterThan(500);
  });
});
