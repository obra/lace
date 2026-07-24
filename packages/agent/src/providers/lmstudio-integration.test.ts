// ABOUTME: Heavy integration tests for LMStudio provider conversation flows
// ABOUTME: Tests tool calling, context preservation, and edge cases with real model

import { describe, it, expect, beforeAll } from 'vitest';
import { LMStudioProvider } from './lmstudio-provider';
import { Tool } from '@lace/agent/tools/tool';
import { ToolResult, ToolContext } from '@lace/agent/tools/types';
import { checkProviderAvailability } from '@lace/agent/test-utils/provider-test-helpers';
import { withSuppressedStdio } from '@lace/agent/test-utils/stdio-suppressor';
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
    _context: ToolContext
  ): Promise<ToolResult> {
    return await Promise.resolve(this.createResult(`Mock executed: ${JSON.stringify(_args)}`));
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
    _context: ToolContext
  ): Promise<ToolResult> {
    return await Promise.resolve(this.createError('Simulated failure'));
  }
}

// The model this suite actually exercises — both the provider's configured
// model and the one passed to every createResponse call, and what the gate
// checks for. The two used to disagree (configured 1.7b, called 30b-a3b), which
// meant a machine running LMStudio with any other model would pass the gate and
// then fail every test on a missing model.
const LMSTUDIO_TEST_MODEL = 'qwen/qwen3-1.7b';

// Check provider availability once at module level
const provider = new LMStudioProvider({
  model: LMSTUDIO_TEST_MODEL,
  systemPrompt: 'You are a helpful assistant. Use tools when asked.',
});

// Suppress all output during provider availability check to prevent WebSocket connection errors
const isLMStudioAvailable = await withSuppressedStdio(async () => {
  return await checkProviderAvailability('LMStudio', provider, LMSTUDIO_TEST_MODEL);
});

const conditionalDescribe = isLMStudioAvailable ? describe.sequential : describe.skip;

conditionalDescribe('LMStudio Provider Integration Tests', () => {
  let mockTool: MockTool;
  let failingTool: FailingTool;

  beforeAll(() => {
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

    const response = await provider.createResponse(messages, [mockTool], LMSTUDIO_TEST_MODEL);

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
            arguments: { action: 'initial' },
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
            status: 'completed' as const,
          },
        ],
      },
      { role: 'user' as const, content: 'Now use it again with action "followup"' },
    ];

    const response = await provider.createResponse(messages, [mockTool], LMSTUDIO_TEST_MODEL);

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
        _context: ToolContext
      ): Promise<ToolResult> {
        return await Promise.resolve(
          this.createResult(`Complex operation completed: ${JSON.stringify(args)}`)
        );
      }
    }

    const complexTool = new ComplexTool();

    const messages = [
      {
        role: 'user' as const,
        content:
          'You must use the complex_tool function call with operation "create", target "test_resource", and include force option. Call the function now.',
      },
    ];

    // Try multiple times as AI models can be unpredictable under load
    let response = await provider.createResponse(messages, [complexTool], LMSTUDIO_TEST_MODEL);
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts && response.toolCalls.length === 0) {
      attempts++;
      if (attempts < maxAttempts) {
        // Wait a bit before retrying
        await new Promise((resolve) => setTimeout(resolve, 1000));
        response = await provider.createResponse(messages, [complexTool], LMSTUDIO_TEST_MODEL);
      }
    }

    // The test should pass if we get tool calls on any attempt
    expect(response.toolCalls.length).toBeGreaterThan(0);
    expect(response.toolCalls[0].name).toBe('complex_tool');
    expect(response.toolCalls[0].input.operation).toBe('create');
    expect(response.toolCalls[0].input.target).toBe('test_resource');
  }, 30000);

  it('should handle tool failure gracefully', async () => {
    const messages = [
      { role: 'user' as const, content: 'Use the failing_tool with message "test failure"' },
    ];

    const response = await provider.createResponse(messages, [failingTool], LMSTUDIO_TEST_MODEL);

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

    const response = await provider.createResponse(messages, [mockTool], LMSTUDIO_TEST_MODEL);

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

    const response = await provider.createResponse(messages, [], LMSTUDIO_TEST_MODEL);

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

    const response = await provider.createResponse(messages, [mockTool], LMSTUDIO_TEST_MODEL);

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

    const response = await provider.createResponse(messages, [], LMSTUDIO_TEST_MODEL);

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
        _context: ToolContext
      ): Promise<ToolResult> {
        return await Promise.resolve(this.createResult(`Weather in ${args.location}: Sunny, 72°F`));
      }
    }

    const simpleTool = new SimpleTool();

    const messages = [
      {
        role: 'user' as const,
        content: 'What is the weather like in San Francisco? Please use the get_weather tool.',
      },
    ];

    const response = await provider.createResponse(messages, [simpleTool], LMSTUDIO_TEST_MODEL);

    // Verify native tool calling works
    expect(response.toolCalls.length).toBeGreaterThan(0);
    expect(response.toolCalls[0].name).toBe('get_weather');
    expect(response.toolCalls[0].input.location).toBe('San Francisco');
    expect(response.content).toBeTruthy();
  }, 30000);
});
