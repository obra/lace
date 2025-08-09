// ABOUTME: Tests for MCP-aligned tool types and utility functions
// ABOUTME: Validates Tool class with annotations and ToolResult with MCP compatibility

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { Tool } from '~/tools/tool';
import {
  ToolResult,
  ToolAnnotations,
  createToolResult,
  createSuccessResult,
  createErrorResult,
} from '~/tools/types';

// Test tool class for testing annotations and schema generation
class TestTool extends Tool {
  name = 'test_tool';
  description = 'A test tool';
  schema = z.object({
    input: z.string(),
  });
  annotations: ToolAnnotations = {
    title: 'Test Tool',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };

  protected async executeValidated(
    _args: any,
    _context: import('~/tools/types').ToolContext
  ): Promise<ToolResult> {
    return await Promise.resolve({
      content: [{ type: 'text', text: 'test' }],
      isError: false,
    });
  }
}

// Simple tool without annotations
class SimpleTool extends Tool {
  name = 'simple_tool';
  description = 'A simple tool';
  schema = z.object({
    param: z.string(),
  });

  protected async executeValidated(
    _args: any,
    _context: import('~/tools/types').ToolContext
  ): Promise<ToolResult> {
    return await Promise.resolve({
      content: [{ type: 'text', text: 'simple' }],
      isError: false,
    });
  }
}

describe('Tool Class with MCP Annotations', () => {
  describe('Tool with annotations', () => {
    it('should support MCP behavioral annotations', () => {
      const tool = new TestTool();

      expect(tool.annotations?.title).toBe('Test Tool');
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.destructiveHint).toBe(false);
      expect(tool.annotations?.idempotentHint).toBe(true);
      expect(tool.annotations?.openWorldHint).toBe(false);
    });

    it('should work without annotations (optional)', () => {
      const tool = new SimpleTool();

      expect(tool.name).toBe('simple_tool');
      expect(tool.description).toBe('A simple tool');
      expect(tool.annotations).toBeUndefined();
    });

    it('should generate JSON schema from Zod schema', () => {
      const tool = new TestTool();
      const schema = tool.inputSchema;

      expect(schema.type).toBe('object');
      expect(schema.properties.input).toBeDefined();
      expect(schema.properties.input.type).toBe('string');
      expect(schema.required).toContain('input');
    });

    it('should execute with validated arguments', async () => {
      const tool = new TestTool();
      const result = await tool.execute(
        { input: 'test value' },
        { signal: new AbortController().signal }
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe('test');
    });

    it('should validate arguments and return errors for invalid input', async () => {
      const tool = new TestTool();
      const result = await tool.execute(
        { invalid: 'test' },
        { signal: new AbortController().signal }
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
    });
  });
});

describe('ToolResult utility functions', () => {
  describe('createToolResult', () => {
    it('should create a basic ToolResult', () => {
      const result = createToolResult(false, [{ type: 'text', text: 'success' }]);

      expect(result.isError).toBe(false);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).toBe('success');
    });

    it('should include optional id and metadata', () => {
      const result = createToolResult(false, [{ type: 'text', text: 'success' }], 'test-id', {
        custom: 'data',
      });

      expect(result.id).toBe('test-id');
      expect(result.metadata?.custom).toBe('data');
    });
  });

  describe('createSuccessResult', () => {
    it('should create a success result', () => {
      const result = createSuccessResult([{ type: 'text', text: 'success' }]);

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe('success');
    });
  });

  describe('createErrorResult', () => {
    it('should create error result from string', () => {
      const result = createErrorResult('Something went wrong');

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Something went wrong');
    });

    it('should create error result from content blocks', () => {
      const result = createErrorResult([{ type: 'text', text: 'Custom error' }]);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Custom error');
    });
  });
});
