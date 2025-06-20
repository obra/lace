// ABOUTME: Tests for variable providers - system, git, project, and tool context
// ABOUTME: Tests basic functionality without heuristics

import { describe, it, expect } from 'vitest';
import { 
  SystemVariableProvider,
  GitVariableProvider,
  ProjectVariableProvider,
  ToolVariableProvider,
  PromptVariableManager
} from '../variable-providers.js';
import { Tool } from '../../tools/types.js';

describe('Variable Providers', () => {
  describe('SystemVariableProvider', () => {
    it('should provide system variables', () => {
      const provider = new SystemVariableProvider();
      const variables = provider.getVariables();
      
      expect(variables['system.os']).toBeDefined();
      expect(variables['system.version']).toBeDefined();
      expect(variables['session.startTime']).toBeDefined();
      
      // Check that values are reasonable
      expect(variables['system.os']).toMatch(/win32|darwin|linux/);
      expect(variables['system.version']).toMatch(/^v\d+\.\d+\.\d+/);
      expect(variables['session.startTime']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('GitVariableProvider', () => {
    it('should provide git variables', () => {
      const provider = new GitVariableProvider();
      const variables = provider.getVariables();
      
      expect(variables['git.branch']).toBeDefined();
      expect(variables['git.status']).toBeDefined();
      expect(variables['git.shortlog']).toBeDefined();
      expect(variables['git.user.name']).toBeDefined();
      expect(variables['git.user.email']).toBeDefined();
      
      // Should not be empty strings
      expect(variables['git.branch']).not.toBe('');
      expect(variables['git.status']).not.toBe('');
    });
  });

  describe('ProjectVariableProvider', () => {
    it('should provide project variables', () => {
      const provider = new ProjectVariableProvider();
      const variables = provider.getVariables();
      
      expect(variables['project.cwd']).toBeDefined();
      expect(variables['project.tree']).toBeDefined();
      expect(variables['project.files']).toBeDefined();
      
      // Should have reasonable values
      expect(variables['project.cwd']).toContain('/');
      expect(variables['project.files']).toMatch(/^\d+$/);
    });
  });

  describe('ToolVariableProvider', () => {
    it('should provide tool variables', () => {
      const mockTools: Tool[] = [
        {
          name: 'bash',
          description: 'Execute bash commands',
          input_schema: { type: 'object', properties: {} },
          executeTool: async () => ({ content: [{ type: 'text', text: 'test' }], isError: false })
        },
        {
          name: 'file-read',
          description: 'Read file contents',
          input_schema: { type: 'object', properties: {} },
          executeTool: async () => ({ content: [{ type: 'text', text: 'test' }], isError: false })
        }
      ];
      
      const provider = new ToolVariableProvider(mockTools);
      const variables = provider.getVariables();
      
      expect(variables['tools.list']).toBe('bash, file-read');
      expect(variables['tools.descriptions']).toContain('- bash: Execute bash commands');
      expect(variables['tools.descriptions']).toContain('- file-read: Read file contents');
    });
  });

  describe('PromptVariableManager', () => {
    it('should combine variables from multiple providers', () => {
      const manager = new PromptVariableManager();
      
      // Add system provider
      manager.addProvider(new SystemVariableProvider());
      
      // Add mock tool provider
      const mockTools: Tool[] = [
        {
          name: 'test-tool',
          description: 'Test tool',
          input_schema: { type: 'object', properties: {} },
          executeTool: async () => ({ content: [{ type: 'text', text: 'test' }], isError: false })
        }
      ];
      manager.addProvider(new ToolVariableProvider(mockTools));
      
      const variables = manager.getAllVariables();
      
      // Should have variables from both providers
      expect(variables['system.os']).toBeDefined();
      expect(variables['tools.list']).toBe('test-tool');
    });

    it('should handle provider failures gracefully', () => {
      const manager = new PromptVariableManager();
      
      // Add a provider that throws an error
      const failingProvider = {
        getVariables: () => {
          throw new Error('Provider failed');
        }
      };
      
      manager.addProvider(failingProvider);
      manager.addProvider(new SystemVariableProvider());
      
      // Should still get variables from working provider
      const variables = manager.getAllVariables();
      expect(variables['system.os']).toBeDefined();
    });
  });
});