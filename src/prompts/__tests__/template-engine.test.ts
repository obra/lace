// ABOUTME: Tests for PromptTemplateEngine variable substitution and includes functionality
// ABOUTME: Following TDD approach - tests written before implementation

import { PromptTemplateEngine } from '../template-engine.js';
import { PromptVariableProvider } from '../types.js';

describe('PromptTemplateEngine', () => {
  describe('variable substitution', () => {
    it('should substitute simple variables', () => {
      const engine = new PromptTemplateEngine();
      const variables = { name: 'Claude', version: '3.5' };
      const template = 'Hello {{name}}, you are version {{version}}.';
      
      const result = engine.render(template, variables);
      
      expect(result).toBe('Hello Claude, you are version 3.5.');
    });

    it('should handle missing variables by leaving them unchanged', () => {
      const engine = new PromptTemplateEngine();
      const variables = { name: 'Claude' };
      const template = 'Hello {{name}}, you are version {{version}}.';
      
      const result = engine.render(template, variables);
      
      expect(result).toBe('Hello Claude, you are version {{version}}.');
    });

    it('should handle empty variable values', () => {
      const engine = new PromptTemplateEngine();
      const variables = { name: 'Claude', empty: '' };
      const template = 'Hello {{name}}{{empty}}.';
      
      const result = engine.render(template, variables);
      
      expect(result).toBe('Hello Claude.');
    });

    it('should handle nested object variables with dot notation', () => {
      const engine = new PromptTemplateEngine();
      const variables = { 
        model: { id: 'claude-3-5-sonnet', provider: 'anthropic' },
        system: { os: 'linux', version: '5.4' }
      };
      const template = 'Model: {{model.id}} from {{model.provider}} on {{system.os}} {{system.version}}';
      
      const result = engine.render(template, variables);
      
      expect(result).toBe('Model: claude-3-5-sonnet from anthropic on linux 5.4');
    });

    it('should handle malformed variable syntax gracefully', () => {
      const engine = new PromptTemplateEngine();
      const variables = { name: 'Claude' };
      const template = 'Hello {name} and {{name} and {{{name}}} and {{name}}.';
      
      const result = engine.render(template, variables);
      
      expect(result).toBe('Hello {name} and {{name} and {{{name}}} and Claude.');
    });
  });

  describe('variable providers', () => {
    it('should accept multiple variable providers', () => {
      const engine = new PromptTemplateEngine();
      
      const provider1: PromptVariableProvider = {
        getVariables: () => ({ name: 'Claude', version: '3.5' })
      };
      
      const provider2: PromptVariableProvider = {
        getVariables: () => ({ os: 'linux', arch: 'x64' })
      };
      
      const template = '{{name}} v{{version}} on {{os}}/{{arch}}';
      
      const result = engine.renderWithProviders(template, [provider1, provider2]);
      
      expect(result).toBe('Claude v3.5 on linux/x64');
    });

    it('should handle provider conflicts with later providers winning', () => {
      const engine = new PromptTemplateEngine();
      
      const provider1: PromptVariableProvider = {
        getVariables: () => ({ name: 'Claude', version: '3.0' })
      };
      
      const provider2: PromptVariableProvider = {
        getVariables: () => ({ version: '3.5' })
      };
      
      const template = '{{name}} v{{version}}';
      
      const result = engine.renderWithProviders(template, [provider1, provider2]);
      
      expect(result).toBe('Claude v3.5');
    });

    it('should handle provider errors gracefully', () => {
      const engine = new PromptTemplateEngine();
      
      const provider1: PromptVariableProvider = {
        getVariables: () => ({ name: 'Claude' })
      };
      
      const provider2: PromptVariableProvider = {
        getVariables: () => { throw new Error('Provider error'); }
      };
      
      const template = '{{name}} v{{version}}';
      
      // Should not throw, but should log error and continue with available variables
      const result = engine.renderWithProviders(template, [provider1, provider2]);
      
      expect(result).toBe('Claude v{{version}}');
    });
  });

  describe('include functionality', () => {
    it('should parse include syntax', () => {
      const engine = new PromptTemplateEngine();
      const template = 'Before\n{{include:section.md}}\nAfter';
      
      // Mock file system behavior
      const mockFs = new Map([
        ['section.md', 'Middle content']
      ]);
      
      const result = engine.renderWithIncludes(template, mockFs);
      
      expect(result).toBe('Before\nMiddle content\nAfter');
    });

    it('should handle nested includes', () => {
      const engine = new PromptTemplateEngine();
      const template = 'Start\n{{include:outer.md}}\nEnd';
      
      const mockFs = new Map([
        ['outer.md', 'Outer before\n{{include:inner.md}}\nOuter after'],
        ['inner.md', 'Inner content']
      ]);
      
      const result = engine.renderWithIncludes(template, mockFs);
      
      expect(result).toBe('Start\nOuter before\nInner content\nOuter after\nEnd');
    });

    it('should handle missing include files gracefully', () => {
      const engine = new PromptTemplateEngine();
      const template = 'Before\n{{include:missing.md}}\nAfter';
      
      const mockFs = new Map();
      
      const result = engine.renderWithIncludes(template, mockFs);
      
      expect(result).toBe('Before\n{{include:missing.md}}\nAfter');
    });

    it('should prevent infinite recursion in includes', () => {
      const engine = new PromptTemplateEngine();
      const template = '{{include:recursive.md}}';
      
      const mockFs = new Map([
        ['recursive.md', 'Start {{include:recursive.md}} End']
      ]);
      
      // Should not hang and should handle gracefully
      const result = engine.renderWithIncludes(template, mockFs);
      
      // Should stop after reasonable depth
      expect(result).toContain('Start');
      expect(result).toContain('End');
    });

    it('should combine includes with variable substitution', () => {
      const engine = new PromptTemplateEngine();
      const template = 'Hello {{name}}\n{{include:greeting.md}}';
      const variables = { name: 'Claude', version: '3.5' };
      
      const mockFs = new Map([
        ['greeting.md', 'You are version {{version}}.']
      ]);
      
      const result = engine.renderWithIncludesAndVariables(template, mockFs, variables);
      
      expect(result).toBe('Hello Claude\nYou are version 3.5.');
    });
  });
});