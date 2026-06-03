import { describe, expect, it } from 'vitest';
import {
  EntSessionContextBreakdownResponseSchema,
  EntSessionTokenUsageRequestSchema,
  EntSessionTokenUsageResponseSchema,
  SessionPromptRequestSchema,
  EntSessionInjectRequestSchema,
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

  // track field tests for session/prompt and ent/session/inject
  describe('track field on session/prompt', () => {
    const validPromptRequest = {
      ...baseRequest,
      method: 'session/prompt',
      params: {
        content: [{ type: 'text', text: 'hello' }],
      },
    } as const;

    it('accepts session/prompt with a valid track value', () => {
      const result = SessionPromptRequestSchema.parse({
        ...validPromptRequest,
        params: { ...validPromptRequest.params, track: 'slack:T:C/123' },
      });
      expect(result.params.track).toBe('slack:T:C/123');
    });

    it('accepts session/prompt without track (track is optional)', () => {
      expect(() => SessionPromptRequestSchema.parse(validPromptRequest)).not.toThrow();
    });

    it('rejects session/prompt with track: empty string', () => {
      expect(() =>
        SessionPromptRequestSchema.parse({
          ...validPromptRequest,
          params: { ...validPromptRequest.params, track: '' },
        })
      ).toThrow();
    });
  });

  describe('track field on ent/session/inject', () => {
    const validInjectRequest = {
      ...baseRequest,
      method: 'ent/session/inject',
      params: {
        content: [{ type: 'text', text: 'hello' }],
        priority: 'normal',
      },
    } as const;

    it('accepts ent/session/inject with a valid track value', () => {
      const result = EntSessionInjectRequestSchema.parse({
        ...validInjectRequest,
        params: { ...validInjectRequest.params, track: 'slack:T:C/123' },
      });
      expect(result.params.track).toBe('slack:T:C/123');
    });

    it('accepts ent/session/inject without track (track is optional)', () => {
      expect(() => EntSessionInjectRequestSchema.parse(validInjectRequest)).not.toThrow();
    });

    it('rejects ent/session/inject with track: empty string', () => {
      expect(() =>
        EntSessionInjectRequestSchema.parse({
          ...validInjectRequest,
          params: { ...validInjectRequest.params, track: '' },
        })
      ).toThrow();
    });
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
