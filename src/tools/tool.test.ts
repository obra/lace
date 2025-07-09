// ABOUTME: Tests for schema-based tool validation system
// ABOUTME: Ensures tools validate inputs and handle errors correctly

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { Tool } from '~/tools/tool.js';
import { ToolContext, ToolResult } from '~/tools/types.js';

// Test implementation of new Tool class
class TestTool extends Tool {
  name = 'test_tool';
  description = 'Test tool for validation';
  schema = z.object({
    required: z.string().min(1),
    optional: z.number().optional(),
  });

  executeValidated(args: z.infer<typeof this.schema>, _context?: ToolContext): Promise<ToolResult> {
    return Promise.resolve({
      content: [{ type: 'text' as const, text: `Got: ${args.required}` }],
      isError: false,
    });
  }
}

describe('Tool with schema validation', () => {
  it('validates and executes with valid parameters', async () => {
    const tool = new TestTool();
    const result = await tool.execute({ required: 'hello' }, undefined);

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toBe('Got: hello');
  });

  it('handles optional parameters correctly', async () => {
    const tool = new TestTool();
    const result = await tool.execute({ required: 'hello', optional: 42 }, undefined);

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toBe('Got: hello');
  });

  it('returns validation errors for invalid parameters', async () => {
    const tool = new TestTool();
    const result = await tool.execute({ optional: 123 }, undefined); // missing required field

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Validation failed');
    expect(result.content[0].text).toContain('required');
  });

  it('validates parameter types correctly', async () => {
    const tool = new TestTool();
    const result = await tool.execute({ required: 'hello', optional: 'not-a-number' }, undefined);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Validation failed');
    expect(result.content[0].text).toContain('optional');
  });

  it('rejects empty strings for required string fields', async () => {
    const tool = new TestTool();
    const result = await tool.execute({ required: '' }, undefined);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Validation failed');
  });

  it('generates JSON schema from Zod schema', () => {
    const tool = new TestTool();
    const jsonSchema = tool.inputSchema;

    expect(jsonSchema.type).toBe('object');
    expect(jsonSchema.properties.required).toBeDefined();
    expect(jsonSchema.properties.optional).toBeDefined();
    expect(jsonSchema.required).toContain('required');
    expect(jsonSchema.required).not.toContain('optional');
  });

  it('provides helpful validation error messages', async () => {
    const tool = new TestTool();
    const result = await tool.execute({ required: null }, undefined);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Validation failed');
    expect(result.content[0].text).toContain('Check parameter types and values');
  });
});

// Test complex validation scenarios
class ComplexTestTool extends Tool {
  name = 'complex_test';
  description = 'Tool with complex validation rules';
  schema = z
    .object({
      startLine: z.number().int().positive(),
      endLine: z.number().int().positive(),
      content: z.string().min(1),
    })
    .refine(
      (data) => {
        return data.endLine >= data.startLine;
      },
      {
        message: 'endLine must be >= startLine',
        path: ['endLine'],
      }
    );

  executeValidated(_args: z.infer<typeof this.schema>): Promise<ToolResult> {
    return Promise.resolve({
      content: [{ type: 'text' as const, text: 'validation passed' }],
      isError: false,
    });
  }
}

describe('Tool with complex validation', () => {
  it('validates cross-field constraints', async () => {
    const tool = new ComplexTestTool();
    const result = await tool.execute({
      startLine: 5,
      endLine: 3, // Invalid: end before start
      content: 'test',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('endLine must be >= startLine');
  });

  it('passes when cross-field constraints are met', async () => {
    const tool = new ComplexTestTool();
    const result = await tool.execute({
      startLine: 3,
      endLine: 5,
      content: 'test',
    });

    expect(result.isError).toBe(false);
  });

  it('reports the correct path for cross-field validation errors', async () => {
    const tool = new ComplexTestTool();
    const result = await tool.execute({
      startLine: 10,
      endLine: 5,
      content: 'test',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('endLine: endLine must be >= startLine');
  });
});
