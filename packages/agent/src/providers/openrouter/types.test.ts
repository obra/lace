import { describe, it, expect } from 'vitest';
import { OpenRouterModelSchema, OpenRouterResponseSchema } from './types';

describe('OpenRouter Types', () => {
  it('should parse model response', () => {
    const model = {
      id: 'openai/gpt-4o',
      name: 'GPT-4o',
      context_length: 128000,
      pricing: { prompt: '0.0000025', completion: '0.00001' },
      supported_parameters: ['tools', 'temperature'],
      architecture: { modality: 'text->text' },
    };
    const result = OpenRouterModelSchema.safeParse(model);
    expect(result.success).toBe(true);
  });

  it('should parse model with complete OpenRouter response structure', () => {
    const model = {
      id: 'anthropic/claude-3-5-sonnet',
      name: 'Claude 3.5 Sonnet',
      description: 'Claude 3.5 Sonnet by Anthropic',
      context_length: 200000,
      pricing: {
        prompt: '0.000003',
        completion: '0.000015',
        request: '0.000001',
        image: '0.000012',
      },
      supported_parameters: ['tools', 'temperature', 'top_p'],
      architecture: {
        modality: 'text->text',
        tokenizer: 'cl100k_base',
        instruct_type: null,
      },
      top_provider: {
        context_length: 200000,
        max_completion_tokens: 4096,
        is_moderated: false,
      },
      per_request_limits: null,
    };
    const result = OpenRouterModelSchema.safeParse(model);
    expect(result.success).toBe(true);
  });

  it('should parse response with array of models', () => {
    const response = {
      data: [
        {
          id: 'openai/gpt-4',
          name: 'GPT-4',
          context_length: 8192,
          pricing: { prompt: '0.00003', completion: '0.00006' },
          supported_parameters: ['tools'],
        },
        {
          id: 'anthropic/claude-3',
          name: 'Claude 3',
          context_length: 200000,
          pricing: { prompt: '0.000015', completion: '0.000075' },
        },
      ],
    };
    const result = OpenRouterResponseSchema.safeParse(response);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.data).toHaveLength(2);
    }
  });

  it('should handle models with minimal required fields', () => {
    const model = {
      id: 'test/model',
      name: 'Test Model',
      context_length: 4096,
      pricing: { prompt: '0.001', completion: '0.002' },
    };
    const result = OpenRouterModelSchema.safeParse(model);
    expect(result.success).toBe(true);
  });

  it('should reject model without required fields', () => {
    const invalidModel = {
      id: 'test/model',
      name: 'Test Model',
      // Missing context_length and pricing
    };
    const result = OpenRouterModelSchema.safeParse(invalidModel);
    expect(result.success).toBe(false);
  });
});
