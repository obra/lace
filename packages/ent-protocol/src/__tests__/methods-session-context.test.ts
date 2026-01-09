import { describe, expect, it } from 'vitest';
import {
  EntSessionContextBreakdownResponseSchema,
  EntSessionTokenUsageRequestSchema,
  EntSessionTokenUsageResponseSchema,
} from '../schemas/methods';

const baseRequest = { jsonrpc: '2.0', id: 1 } as const;

describe('Ent protocol session context schemas', () => {
  it('accepts ent/session/token_usage request with and without params', () => {
    expect(() =>
      EntSessionTokenUsageRequestSchema.parse({
        ...baseRequest,
        method: 'ent/session/token_usage',
      })
    ).not.toThrow();

    expect(() =>
      EntSessionTokenUsageRequestSchema.parse({
        ...baseRequest,
        method: 'ent/session/token_usage',
        params: {},
      })
    ).not.toThrow();
  });

  it('accepts ent/session/token_usage response shape', () => {
    expect(() =>
      EntSessionTokenUsageResponseSchema.parse({
        ...baseRequest,
        result: {
          totalPromptTokens: 10,
          totalCompletionTokens: 20,
          totalTokens: 30,
          contextLimit: 1000,
          percentUsed: 0.03,
          nearLimit: false,
        },
      })
    ).not.toThrow();
  });

  it('accepts ent/session/context_breakdown response shape', () => {
    expect(() =>
      EntSessionContextBreakdownResponseSchema.parse({
        ...baseRequest,
        result: {
          timestamp: new Date().toISOString(),
          modelId: 'gpt-4o',
          contextLimit: 1000,
          totalUsedTokens: 300,
          percentUsed: 0.3,
          categories: {
            systemPrompt: { tokens: 10 },
            coreTools: { tokens: 20, items: [{ name: 'bash', tokens: 5 }] },
            mcpTools: { tokens: 0, items: [] },
            messages: {
              tokens: 100,
              subcategories: {
                userMessages: { tokens: 10 },
                agentMessages: { tokens: 10 },
                toolCalls: { tokens: 40 },
                toolResults: { tokens: 40 },
              },
            },
            reservedForResponse: { tokens: 4096 },
            freeSpace: { tokens: 0 },
          },
        },
      })
    ).not.toThrow();
  });
});
