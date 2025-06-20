// ABOUTME: Tests for ToolVariableProvider - Tool documentation from ToolRegistry
// ABOUTME: Following TDD approach - tests written before implementation

import { ToolVariableProvider } from '../variable-providers/tool.js';
import { Tool } from '../../tools/types.js';

describe('ToolVariableProvider', () => {
  let mockTool1: Tool;
  let mockTool2: Tool;
  let mockTools: Tool[];
  let provider: ToolVariableProvider;

  beforeEach(() => {
    mockTool1 = {
      name: 'bash',
      description: 'Execute bash commands',
      input_schema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The bash command to execute' }
        },
        required: ['command']
      },
      executeTool: async () => ({ content: [{ type: 'text', text: 'result' }], isError: false })
    };

    mockTool2 = {
      name: 'file_read',
      description: 'Read file contents',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file to read' }
        },
        required: ['path']
      },
      executeTool: async () => ({ content: [{ type: 'text', text: 'file content' }], isError: false })
    };

    mockTools = [mockTool1, mockTool2];
    provider = new ToolVariableProvider(mockTools);
  });

  it('should provide list of available tools', () => {
    const variables = provider.getVariables();
    
    expect(variables.tools).toBeDefined();
    expect(typeof variables.tools).toBe('object');
    
    const tools = variables.tools as Record<string, unknown>;
    expect(tools.list).toBeDefined();
    expect(Array.isArray(tools.list)).toBe(true);
    expect(tools.list).toEqual(['bash', 'file_read']);
  });

  it('should provide tool descriptions', () => {
    const variables = provider.getVariables();
    
    const tools = variables.tools as Record<string, unknown>;
    expect(tools.descriptions).toBeDefined();
    expect(typeof tools.descriptions).toBe('string');
    
    const descriptions = tools.descriptions as string;
    expect(descriptions).toContain('bash: Execute bash commands');
    expect(descriptions).toContain('file_read: Read file contents');
  });

  it('should provide detailed tool documentation', () => {
    const variables = provider.getVariables();
    
    const tools = variables.tools as Record<string, unknown>;
    expect(tools.documentation).toBeDefined();
    expect(typeof tools.documentation).toBe('string');
    
    const documentation = tools.documentation as string;
    expect(documentation).toContain('bash');
    expect(documentation).toContain('Execute bash commands');
    expect(documentation).toContain('command');
    expect(documentation).toContain('The bash command to execute');
  });

  it('should provide tool count', () => {
    const variables = provider.getVariables();
    
    const tools = variables.tools as Record<string, unknown>;
    expect(tools.count).toBeDefined();
    expect(tools.count).toBe(2);
  });

  it('should handle empty tool list', () => {
    const emptyProvider = new ToolVariableProvider([]);
    const variables = emptyProvider.getVariables();
    
    const tools = variables.tools as Record<string, unknown>;
    expect(tools.list).toEqual([]);
    expect(tools.count).toBe(0);
    expect(tools.descriptions).toBe('(no tools available)');
    expect(tools.documentation).toBe('(no tools available)');
  });

  it('should handle tools with complex schemas', () => {
    const complexTool: Tool = {
      name: 'complex_tool',
      description: 'A tool with complex schema',
      input_schema: {
        type: 'object',
        properties: {
          config: {
            type: 'object',
            properties: {
              mode: { type: 'string', enum: ['fast', 'thorough'] },
              timeout: { type: 'number', minimum: 0 }
            }
          },
          files: {
            type: 'array',
            items: { type: 'string' }
          }
        },
        required: ['config']
      },
      executeTool: async () => ({ content: [{ type: 'text', text: 'result' }], isError: false })
    };

    const complexProvider = new ToolVariableProvider([complexTool]);
    const variables = complexProvider.getVariables();
    
    const tools = variables.tools as Record<string, unknown>;
    const documentation = tools.documentation as string;
    
    expect(documentation).toContain('complex_tool');
    expect(documentation).toContain('config');
    expect(documentation).toContain('files');
  });

  it('should format tool documentation readably', () => {
    const variables = provider.getVariables();
    
    const tools = variables.tools as Record<string, unknown>;
    const documentation = tools.documentation as string;
    
    // Should have clear formatting with line breaks and structure
    expect(documentation).toContain('\n');
    expect(documentation).toMatch(/^## Available Tools/);
  });

  it('should provide tool categories if available', () => {
    const variables = provider.getVariables();
    
    const tools = variables.tools as Record<string, unknown>;
    expect(tools.categories).toBeDefined();
    expect(typeof tools.categories).toBe('object');
    
    const categories = tools.categories as Record<string, string[]>;
    expect(categories.system).toContain('bash');
    expect(categories.files).toContain('file_read');
  });

  it('should handle malformed tool schemas gracefully', () => {
    const malformedTool: Tool = {
      name: 'malformed',
      description: 'Tool with issues',
      input_schema: null as any, // Intentionally malformed
      executeTool: async () => ({ content: [{ type: 'text', text: 'result' }], isError: false })
    };

    const malformedProvider = new ToolVariableProvider([malformedTool]);
    
    expect(() => malformedProvider.getVariables()).not.toThrow();
    
    const variables = malformedProvider.getVariables();
    const tools = variables.tools as Record<string, unknown>;
    expect(tools.list).toContain('malformed');
  });
});