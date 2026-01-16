// ABOUTME: Tests for Anthropic API response type schemas
// ABOUTME: Validates Zod schemas match Anthropic's /v1/models endpoint format

import { describe, it, expect } from 'vitest';
import { AnthropicModelSchema, AnthropicModelsResponseSchema } from '../types';

describe('AnthropicModelSchema', () => {
  it('parses a valid model object', () => {
    const validModel = {
      id: 'claude-sonnet-4-20250514',
      type: 'model',
      display_name: 'Claude Sonnet 4',
      created_at: '2025-05-14T00:00:00Z',
    };

    const result = AnthropicModelSchema.safeParse(validModel);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('claude-sonnet-4-20250514');
      expect(result.data.display_name).toBe('Claude Sonnet 4');
    }
  });

  it('rejects model with wrong type field', () => {
    const invalidModel = {
      id: 'claude-sonnet-4-20250514',
      type: 'assistant', // wrong type
      display_name: 'Claude Sonnet 4',
      created_at: '2025-05-14T00:00:00Z',
    };

    const result = AnthropicModelSchema.safeParse(invalidModel);
    expect(result.success).toBe(false);
  });

  it('rejects model missing required fields', () => {
    const invalidModel = {
      id: 'claude-sonnet-4-20250514',
      // missing type, display_name, created_at
    };

    const result = AnthropicModelSchema.safeParse(invalidModel);
    expect(result.success).toBe(false);
  });
});

describe('AnthropicModelsResponseSchema', () => {
  it('parses a valid models list response', () => {
    const validResponse = {
      data: [
        {
          id: 'claude-sonnet-4-20250514',
          type: 'model',
          display_name: 'Claude Sonnet 4',
          created_at: '2025-05-14T00:00:00Z',
        },
        {
          id: 'claude-3-5-haiku-20241022',
          type: 'model',
          display_name: 'Claude 3.5 Haiku',
          created_at: '2024-10-22T00:00:00Z',
        },
      ],
      has_more: false,
      first_id: 'claude-sonnet-4-20250514',
      last_id: 'claude-3-5-haiku-20241022',
    };

    const result = AnthropicModelsResponseSchema.safeParse(validResponse);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.data).toHaveLength(2);
      expect(result.data.has_more).toBe(false);
    }
  });

  it('parses response with null pagination ids', () => {
    const validResponse = {
      data: [],
      has_more: false,
      first_id: null,
      last_id: null,
    };

    const result = AnthropicModelsResponseSchema.safeParse(validResponse);
    expect(result.success).toBe(true);
  });

  it('parses response indicating more pages available', () => {
    const validResponse = {
      data: [
        {
          id: 'claude-sonnet-4-20250514',
          type: 'model',
          display_name: 'Claude Sonnet 4',
          created_at: '2025-05-14T00:00:00Z',
        },
      ],
      has_more: true,
      first_id: 'claude-sonnet-4-20250514',
      last_id: 'claude-sonnet-4-20250514',
    };

    const result = AnthropicModelsResponseSchema.safeParse(validResponse);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.has_more).toBe(true);
    }
  });

  it('rejects response missing required fields', () => {
    const invalidResponse = {
      data: [],
      // missing has_more, first_id, last_id
    };

    const result = AnthropicModelsResponseSchema.safeParse(invalidResponse);
    expect(result.success).toBe(false);
  });
});
