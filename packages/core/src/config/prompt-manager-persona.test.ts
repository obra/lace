import { describe, it, expect } from 'vitest';

describe('PromptManager with Personas - Integration', () => {
  describe('API changes', () => {
    it('should have generateSystemPrompt method that accepts persona parameter', async () => {
      const { PromptManager } = await import('./prompt-manager');
      const promptManager = new PromptManager({});
      
      // Should not throw when calling with persona parameter
      expect(typeof promptManager.generateSystemPrompt).toBe('function');
      
      // Should accept optional persona parameter
      const prompt1 = await promptManager.generateSystemPrompt();
      const prompt2 = await promptManager.generateSystemPrompt('lace');
      
      expect(typeof prompt1).toBe('string');
      expect(typeof prompt2).toBe('string');
      expect(prompt1.length).toBeGreaterThan(0);
      expect(prompt2.length).toBeGreaterThan(0);
    });

    it('should have loadPromptConfig function that accepts persona in options', async () => {
      const { loadPromptConfig } = await import('./prompts');
      
      // Should not throw when calling with persona in options
      const config1 = await loadPromptConfig();
      const config2 = await loadPromptConfig({ persona: 'lace' });
      
      expect(config1).toHaveProperty('systemPrompt');
      expect(config1).toHaveProperty('userInstructions');
      expect(config1).toHaveProperty('filesCreated');
      
      expect(config2).toHaveProperty('systemPrompt');
      expect(config2).toHaveProperty('userInstructions');
      expect(config2).toHaveProperty('filesCreated');
      
      expect(typeof config1.systemPrompt).toBe('string');
      expect(typeof config2.systemPrompt).toBe('string');
    });
  });

  describe('persona validation integration', () => {
    it('should validate persona parameter when provided', async () => {
      const { PromptManager } = await import('./prompt-manager');
      const promptManager = new PromptManager({});
      
      // Should handle invalid persona gracefully (fallback)
      const prompt = await promptManager.generateSystemPrompt('nonexistent-persona');
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(0);
      // Should fallback to default prompt
      expect(prompt).toBe('You are Lace, an AI coding assistant. Use the available tools to help with programming tasks.');
    });

    it('should work with valid default persona', async () => {
      const { PromptManager } = await import('./prompt-manager');
      const promptManager = new PromptManager({});
      
      // Should work with lace persona (which exists in actual files)
      const prompt = await promptManager.generateSystemPrompt('lace');
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(0);
    });
  });

  describe('loadPromptConfig integration', () => {
    it('should pass persona parameter to PromptManager', async () => {
      const { loadPromptConfig } = await import('./prompts');
      
      // Should work with valid persona
      const config = await loadPromptConfig({ persona: 'lace' });
      expect(config.systemPrompt).toBeTruthy();
      expect(typeof config.systemPrompt).toBe('string');
    });

    it('should handle invalid persona gracefully', async () => {
      const { loadPromptConfig } = await import('./prompts');
      
      // Should fallback gracefully for invalid persona
      const config = await loadPromptConfig({ persona: 'invalid-persona' });
      expect(config.systemPrompt).toBeTruthy();
      expect(typeof config.systemPrompt).toBe('string');
      // Should fallback to default prompt
      expect(config.systemPrompt).toBe('You are Lace, an AI coding assistant. Use the available tools to help with programming tasks.');
    });

    it('should combine persona with other options', async () => {
      const { loadPromptConfig } = await import('./prompts');
      
      const tools = [
        { name: 'bash', description: 'Execute bash commands' },
        { name: 'read', description: 'Read files' }
      ];
      
      // Should work with persona and tools together
      const config = await loadPromptConfig({ 
        persona: 'lace',
        tools 
      });
      
      expect(config.systemPrompt).toBeTruthy();
      expect(config.userInstructions).toBeDefined();
      expect(Array.isArray(config.filesCreated)).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle template errors gracefully', async () => {
      const { PromptManager } = await import('./prompt-manager');
      const promptManager = new PromptManager({});
      
      // Even with errors, should return fallback prompt
      const prompt = await promptManager.generateSystemPrompt('any-persona');
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(0);
    });
  });
});