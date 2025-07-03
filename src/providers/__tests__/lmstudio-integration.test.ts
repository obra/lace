// ABOUTME: Heavy integration tests for LMStudio provider conversation flows
// ABOUTME: Tests tool calling, context preservation, and edge cases with real model

import { describe, it, expect, beforeAll } from 'vitest';
import { LMStudioProvider } from '../lmstudio-provider.js';
import { Tool } from '../../tools/tool.js';
import { ToolResult, ToolContext } from '../../tools/types.js';
import { checkProviderAvailability } from '../../__tests__/utils/provider-test-helpers.js';
import { z } from 'zod';

// Mock tool for testing without side effects
class MockTool extends Tool {
  name = 'mock_tool';
  description = 'A mock tool for testing';
  schema = z.object({
    action: z.string().describe('Action to perform'),
    value: z.string().describe('Value to use').optional(),
  });

  protected async executeValidated(
    _args: { action: string; value?: string },
    _context?: ToolContext
  ): Promise<ToolResult> {
    return this.createResult(`Mock executed: ${JSON.stringify(_args)}`);
  }
}

// Test tool that always fails
class FailingTool extends Tool {
  name = 'failing_tool';
  description = 'A tool that always fails';
  schema = z.object({
    message: z.string().describe('Error message'),
  });

  protected async executeValidated(
    _args: { message: string },
    _context?: ToolContext
  ): Promise<ToolResult> {
    return this.createError('Simulated failure');
  }
}

// Check provider availability once at module level
const provider = new LMStudioProvider({
  model: 'qwen/qwen3-1.7b',
  systemPrompt: 'You are a helpful assistant. Use tools when asked.',
});

const isLMStudioAvailable = await checkProviderAvailability('LMStudio', provider);

const conditionalDescribe = isLMStudioAvailable ? describe.sequential : describe.skip;

conditionalDescribe('LMStudio Provider Integration Tests', () => {
  let mockTool: MockTool;
  let failingTool: FailingTool;

  beforeAll(async () => {
    mockTool = new MockTool();
    failingTool = new FailingTool();
  });

  it('should handle multiple tool calls in sequence', async () => {
    const messages = [
      {
        role: 'user' as const,
        content: 'Use the mock_tool with action "test1" then action "test2"',
      },
    ];

    const response = await provider.createResponse(messages, [mockTool]);

    // With native tool calling, we should get proper tool calls
    expect(response.content).toBeTruthy();
    expect(response.content.length).toBeGreaterThan(0);
    // The model should attempt to use the tool
    expect(response.toolCalls.length).toBeGreaterThanOrEqual(1);
  }, 30000);

  it('should handle conversation with tool results', async () => {
    const messages = [
      { role: 'user' as const, content: 'Use mock_tool with action "initial"' },
      {
        role: 'assistant' as const,
        content: "I'll use the mock tool for you.",
        toolCalls: [
          {
            id: 'call_1',
            name: 'mock_tool',
            input: { action: 'initial' },
          },
        ],
      },
      {
        role: 'user' as const,
        content: '',
        toolResults: [
          {
            id: 'call_1',
            content: [{ type: 'text' as const, text: 'Mock executed: {"action":"initial"}' }],
            isError: false,
          },
        ],
      },
      { role: 'user' as const, content: 'Now use it again with action "followup"' },
    ];

    const response = await provider.createResponse(messages, [mockTool]);

    expect(response.toolCalls.length).toBeGreaterThanOrEqual(1);
    expect(response.toolCalls[0].name).toBe('mock_tool');
    expect(response.toolCalls[0].input.action).toBe('followup');
  }, 30000);

  it('should handle complex tool instructions', async () => {
    class ComplexTool extends Tool {
      name = 'complex_tool';
      description = 'A tool with complex parameters';
      schema = z.object({
        operation: z.string().describe('Operation to perform (create, update, or delete)'),
        target: z.string().describe('Target resource'),
        options: z.object({}).passthrough().describe('Additional options').optional(),
      });

      protected async executeValidated(
        args: { operation: string; target: string; options?: any },
        _context?: ToolContext
      ): Promise<ToolResult> {
        return this.createResult(`Complex operation completed: ${JSON.stringify(args)}`);
      }
    }

    const complexTool = new ComplexTool();

    const messages = [
      {
        role: 'user' as const,
        content:
          'Use complex_tool to create a resource called "test_resource" with force option enabled',
      },
    ];

    const response = await provider.createResponse(messages, [complexTool]);

    expect(response.toolCalls.length).toBeGreaterThan(0);
    expect(response.toolCalls[0].name).toBe('complex_tool');
    expect(response.toolCalls[0].input.operation).toBe('create');
    expect(response.toolCalls[0].input.target).toBe('test_resource');
  }, 30000);

  it('should handle tool failure gracefully', async () => {
    const messages = [
      { role: 'user' as const, content: 'Use the failing_tool with message "test failure"' },
    ];

    const response = await provider.createResponse(messages, [failingTool]);

    // Should still generate a tool call even if we know it will fail
    expect(response.toolCalls.length).toBeGreaterThanOrEqual(1);
    expect(response.toolCalls[0].name).toBe('failing_tool');
  }, 30000);

  it('should handle mixed tool and text responses', async () => {
    const messages = [
      {
        role: 'user' as const,
        content:
          'We\'re testing tool usage. You MUST use the tool `mock_tool` with action "explain", then summarize the results. (We want to make sure a tool call happens in the middle of your process.) /nothink',
      },
    ];

    const response = await provider.createResponse(messages, [mockTool]);

    // Should have both text content and tool calls
    // Should have both text content and tool calls
    expect(response.content).toBeTruthy();
    // LMStudio responses can be variable, so just check for any content
    expect(response.content.length).toBeGreaterThan(0);
    expect(response.toolCalls.length).toBeGreaterThan(0);
    expect(response.toolCalls[0].name).toBe('mock_tool');
  }, 30000);

  it('should handle no available tools', async () => {
    const messages = [{ role: 'user' as const, content: 'Hello, can you help me?' }];

    const response = await provider.createResponse(messages, []);

    expect(response.content).toBeTruthy();
    expect(response.toolCalls.length).toBe(0);
  }, 30000);

  it('should handle malformed tool instructions', async () => {
    const messages = [
      {
        role: 'user' as const,
        content: 'Use some_nonexistent_tool with invalid parameters',
      },
    ];

    const response = await provider.createResponse(messages, [mockTool]);

    // Should respond without crashing, might not generate tool calls for nonexistent tool
    expect(response.content).toBeTruthy();
  }, 30000);

  it('should handle unicode and special characters', async () => {
    const messages = [
      {
        role: 'user' as const,
        content: 'Respond with these characters: 🚀 α β γ "quotes" \'apostrophes\' & <tags>',
      },
    ];

    const response = await provider.createResponse(messages, []);

    expect(response.content).toBeTruthy();
    // Should handle the request without crashing
    expect(response.content.length).toBeGreaterThan(5);
  }, 30000);

  it('should execute tools using native tool calling', async () => {
    class SimpleTool extends Tool {
      name = 'get_weather';
      description = 'Get weather information for a location';
      schema = z.object({
        location: z.string().describe('Location name'),
      });

      protected async executeValidated(
        args: { location: string },
        _context?: ToolContext
      ): Promise<ToolResult> {
        return this.createResult(`Weather in ${args.location}: Sunny, 72°F`);
      }
    }

    const simpleTool = new SimpleTool();

    const messages = [
      {
        role: 'user' as const,
        content: 'What is the weather like in San Francisco? Please use the get_weather tool.',
      },
    ];

    const response = await provider.createResponse(messages, [simpleTool]);

    // Verify native tool calling works
    expect(response.toolCalls.length).toBeGreaterThan(0);
    expect(response.toolCalls[0].name).toBe('get_weather');
    expect(response.toolCalls[0].input.location).toBe('San Francisco');
    expect(response.content).toBeTruthy();
  }, 30000);
});
