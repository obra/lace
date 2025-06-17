// ABOUTME: Tests for MCP-aligned tool types and utility functions
// ABOUTME: Validates Tool interface with annotations and ToolResult with MCP compatibility

import { describe, it, expect } from 'vitest';
import {
  Tool,
  ToolResult,
  ToolAnnotations,
  createToolResult,
  createSuccessResult,
  createErrorResult,
} from '../types.js';

describe('Tool Interface with MCP Annotations', () => {
  describe('Tool with annotations', () => {
    it('should support MCP behavioral annotations', () => {
      const tool: Tool = {
        name: 'test_tool',
        description: 'A test tool',
        input_schema: {
          type: 'object',
          properties: {
            input: { type: 'string' },
          },
          required: ['input'],
        },
        annotations: {
          title: 'Test Tool',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        executeTool: async () => createSuccessResult([{ type: 'text', text: 'test' }]),
      };

      expect(tool.annotations?.title).toBe('Test Tool');
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.destructiveHint).toBe(false);
      expect(tool.annotations?.idempotentHint).toBe(true);
      expect(tool.annotations?.openWorldHint).toBe(false);
    });

    it('should work without annotations (optional)', () => {
      const tool: Tool = {
        name: 'simple_tool',
        description: 'A simple tool',
        input_schema: {
          type: 'object',
          properties: {},
          required: [],
        },
        executeTool: async () => createSuccessResult([]),
      };

      expect(tool.annotations).toBeUndefined();
    });

    it('should support partial annotations', () => {
      const tool: Tool = {
        name: 'partial_tool',
        description: 'Tool with partial annotations',
        input_schema: {
          type: 'object',
          properties: {},
          required: [],
        },
        annotations: {
          destructiveHint: true,
        },
        executeTool: async () => createSuccessResult([]),
      };

      expect(tool.annotations?.destructiveHint).toBe(true);
    });
  });

  describe('ToolAnnotations type', () => {
    it('should have correct structure', () => {
      const annotations: ToolAnnotations = {
        title: 'My Tool',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      };

      expect(typeof annotations.title).toBe('string');
      expect(typeof annotations.readOnlyHint).toBe('boolean');
      expect(typeof annotations.destructiveHint).toBe('boolean');
      expect(typeof annotations.idempotentHint).toBe('boolean');
      expect(typeof annotations.openWorldHint).toBe('boolean');
    });

    it('should allow empty annotations object', () => {
      const annotations: ToolAnnotations = {};
      expect(Object.keys(annotations)).toHaveLength(0);
    });
  });
});

describe('ToolResult with MCP Compatibility', () => {
  describe('MCP-aligned result structure', () => {
    it('should have isError field that reflects success status', () => {
      const successResult: ToolResult = {
        content: [{ type: 'text', text: 'success' }],
        isError: false,
      };

      const errorResult: ToolResult = {
        content: [{ type: 'text', text: 'error message' }],
        isError: true,
      };

      expect(successResult.isError).toBe(false);
      expect(errorResult.isError).toBe(true);
    });

    it('should support all content types', () => {
      const result: ToolResult = {
        content: [
          { type: 'text', text: 'text content' },
          { type: 'image', data: 'base64data' },
          { type: 'resource', uri: 'file://test.txt' },
        ],
        isError: false,
      };

      expect(result.content).toHaveLength(3);
      expect(result.content[0].type).toBe('text');
      expect(result.content[1].type).toBe('image');
      expect(result.content[2].type).toBe('resource');
    });
  });

  describe('createToolResult utility', () => {
    it('should create success result with isError false', () => {
      const result = createToolResult(false, [{ type: 'text', text: 'Operation completed' }]);

      expect(result.isError).toBe(false);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).toBe('Operation completed');
    });

    it('should create error result with isError true', () => {
      const result = createToolResult(true, [{ type: 'text', text: 'Operation failed' }]);

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).toBe('Operation failed');
    });

    it('should handle empty content', () => {
      const result = createToolResult(false, []);

      expect(result.isError).toBe(false);
      expect(result.content).toHaveLength(0);
    });

    it('should handle multiple content blocks', () => {
      const result = createToolResult(false, [
        { type: 'text', text: 'First block' },
        { type: 'text', text: 'Second block' },
      ]);

      expect(result.isError).toBe(false);
      expect(result.content).toHaveLength(2);
    });
  });

  describe('createSuccessResult utility', () => {
    it('should create success result', () => {
      const result = createSuccessResult([{ type: 'text', text: 'Success!' }]);

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe('Success!');
    });

    it('should create success result with empty content', () => {
      const result = createSuccessResult([]);

      expect(result.isError).toBe(false);
      expect(result.content).toHaveLength(0);
    });
  });

  describe('createErrorResult utility', () => {
    it('should create error result with message', () => {
      const result = createErrorResult('Something went wrong');

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toBe('Something went wrong');
    });

    it('should create error result with custom content', () => {
      const result = createErrorResult([{ type: 'text', text: 'Custom error content' }]);

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).toBe('Custom error content');
    });
  });
});

describe('ContentBlock types', () => {
  it('should support text content', () => {
    const textBlock = { type: 'text' as const, text: 'Hello world' };
    expect(textBlock.type).toBe('text');
    expect(textBlock.text).toBe('Hello world');
  });

  it('should support image content', () => {
    const imageBlock = { type: 'image' as const, data: 'base64encodeddata' };
    expect(imageBlock.type).toBe('image');
    expect(imageBlock.data).toBe('base64encodeddata');
  });

  it('should support resource content', () => {
    const resourceBlock = { type: 'resource' as const, uri: 'file://example.txt' };
    expect(resourceBlock.type).toBe('resource');
    expect(resourceBlock.uri).toBe('file://example.txt');
  });
});
