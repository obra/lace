// ABOUTME: Tests for LMStudio provider implementation
// ABOUTME: Verifies tool call extraction, response formatting, and provider configuration

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LMStudioProvider } from '../lmstudio-provider.js';
import { Tool, ToolContext } from '../../tools/types.js';

// Mock the LMStudio SDK
vi.mock('@lmstudio/sdk', () => {
  const mockModel = {
    respond: vi.fn(),
  };

  const mockClient = {
    llm: {
      load: vi.fn().mockResolvedValue(mockModel),
    },
  };

  return {
    LMStudioClient: vi.fn().mockImplementation(() => mockClient),
  };
});

describe('LMStudioProvider', () => {
  let provider: LMStudioProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new LMStudioProvider();
  });

  describe('configuration', () => {
    it('should have correct provider name', () => {
      expect(provider.providerName).toBe('lmstudio');
    });

    it('should have correct default model', () => {
      expect(provider.defaultModel).toBe('qwen/qwen3-30b-a3b');
    });

    it('should accept custom configuration', () => {
      const customProvider = new LMStudioProvider({
        model: 'custom-model',
        maxTokens: 2000,
        verbose: true,
      });

      expect(customProvider.providerName).toBe('lmstudio');
    });
  });

  describe('tool call extraction', () => {
    it('should extract tool calls from JSON code blocks', () => {
      const response = `Here's the weather:

\`\`\`json
{
  "name": "get_weather",
  "arguments": {
    "location": "San Francisco, CA",
    "unit": "celsius"
  }
}
\`\`\`

The weather looks good!`;

      const toolCalls = provider['_extractToolCalls'](response);

      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].name).toBe('get_weather');
      expect(toolCalls[0].input).toEqual({
        location: 'San Francisco, CA',
        unit: 'celsius',
      });
      expect(toolCalls[0].id).toMatch(/^call_\d+$/);
    });

    it('should extract multiple tool calls', () => {
      const response = `First tool:

\`\`\`json
{
  "name": "get_weather",
  "arguments": {
    "location": "San Francisco"
  }
}
\`\`\`

Second tool:

\`\`\`json
{
  "name": "search_web",
  "arguments": {
    "query": "weather forecast"
  }
}
\`\`\``;

      const toolCalls = provider['_extractToolCalls'](response);

      expect(toolCalls).toHaveLength(2);
      expect(toolCalls[0].name).toBe('get_weather');
      expect(toolCalls[1].name).toBe('search_web');
    });

    it('should extract standalone JSON tool calls', () => {
      const response = `I'll check the weather: {"name": "get_weather", "arguments": {"location": "Boston"}}`;

      const toolCalls = provider['_extractToolCalls'](response);

      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].name).toBe('get_weather');
      expect(toolCalls[0].input).toEqual({ location: 'Boston' });
    });

    it('should ignore invalid JSON', () => {
      const response = `Here's some broken JSON:

\`\`\`json
{
  "name": "get_weather"
  "arguments": {
    "location": "broken
  }
}
\`\`\`

And some regular text.`;

      const toolCalls = provider['_extractToolCalls'](response);
      expect(toolCalls).toHaveLength(0);
    });

    it('should handle empty response', () => {
      const toolCalls = provider['_extractToolCalls']('');
      expect(toolCalls).toHaveLength(0);
    });
  });

  describe('content cleaning', () => {
    it('should remove JSON code blocks from content', () => {
      const response = `Here's the weather:

\`\`\`json
{
  "name": "get_weather",
  "arguments": {
    "location": "San Francisco"
  }
}
\`\`\`

The temperature is 72°F.`;

      const cleaned = provider['_removeToolCallsFromContent'](response);

      expect(cleaned).toBe(`Here's the weather:\n\nThe temperature is 72°F.`);
    });

    it('should remove standalone JSON tool calls', () => {
      const response = `Checking weather {"name": "get_weather", "arguments": {"location": "NYC"}} and the result is sunny.`;

      const cleaned = provider['_removeToolCallsFromContent'](response);

      expect(cleaned).toBe('Checking weather  and the result is sunny.');
    });

    it('should handle content with no tool calls', () => {
      const response = 'Just a regular message with no tools.';
      const cleaned = provider['_removeToolCallsFromContent'](response);

      expect(cleaned).toBe(response);
    });
  });

  describe('tool instructions', () => {
    it('should build proper tool instructions', () => {
      const tools: Tool[] = [
        {
          name: 'get_weather',
          description: 'Get weather for a location',
          input_schema: {
            type: 'object',
            properties: {
              location: { type: 'string' },
            },
            required: ['location'],
          },
          executeTool: async (_input: Record<string, unknown>, _context?: ToolContext) => ({
            success: true,
            content: [{ type: 'text' as const, text: 'sunny' }],
          }),
        },
      ];

      const instructions = provider['_buildToolInstructions'](tools);

      expect(instructions).toContain('get_weather');
      expect(instructions).toContain('Get weather for a location');
      expect(instructions).toContain('location');
      expect(instructions).toContain('```json');
    });

    it('should handle multiple tools', () => {
      const tools: Tool[] = [
        {
          name: 'tool1',
          description: 'First tool',
          input_schema: { type: 'object', properties: {}, required: [] },
          executeTool: async (_input: Record<string, unknown>, _context?: ToolContext) => ({
            success: true,
            content: [{ type: 'text' as const, text: 'result1' }],
          }),
        },
        {
          name: 'tool2',
          description: 'Second tool',
          input_schema: { type: 'object', properties: {}, required: [] },
          executeTool: async (_input: Record<string, unknown>, _context?: ToolContext) => ({
            success: true,
            content: [{ type: 'text' as const, text: 'result2' }],
          }),
        },
      ];

      const instructions = provider['_buildToolInstructions'](tools);

      expect(instructions).toContain('tool1');
      expect(instructions).toContain('tool2');
      expect(instructions).toContain('First tool');
      expect(instructions).toContain('Second tool');
    });
  });
});
