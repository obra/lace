import { describe, it, expect } from 'vitest';
import { ModelFilterService } from './filter-service';
import type { OpenRouterModel } from './types';
import type { ModelConfig } from '../catalog/types';

describe('ModelFilterService', () => {
  const createModel = (overrides: Partial<OpenRouterModel> = {}): OpenRouterModel => ({
    id: 'openai/gpt-4',
    name: 'GPT-4',
    context_length: 8192,
    pricing: { prompt: '0.00003', completion: '0.00006' },
    supported_parameters: ['tools', 'temperature'],
    ...overrides,
  });

  it('should filter by disabled providers', () => {
    const service = new ModelFilterService();
    const models = [
      createModel({ id: 'openai/gpt-4' }),
      createModel({ id: 'anthropic/claude' }),
      createModel({ id: 'google/gemini' }),
    ];

    const config: ModelConfig = {
      enableNewModels: true,
      disabledProviders: ['google'],
      disabledModels: [],
    };

    const filtered = service.filterModels(models, config);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((m) => m.id)).not.toContain('google/gemini');
  });

  it('should filter by disabled models', () => {
    const service = new ModelFilterService();
    const models = [createModel({ id: 'openai/gpt-4' }), createModel({ id: 'openai/gpt-3.5' })];

    const config: ModelConfig = {
      enableNewModels: true,
      disabledModels: ['openai/gpt-3.5'],
      disabledProviders: [],
    };

    const filtered = service.filterModels(models, config);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('openai/gpt-4');
  });

  it('should filter by required parameters', () => {
    const service = new ModelFilterService();
    const models = [
      createModel({ supported_parameters: ['tools', 'temperature'] }),
      createModel({ supported_parameters: ['temperature'] }),
    ];

    const config: ModelConfig = {
      enableNewModels: true,
      disabledModels: [],
      disabledProviders: [],
      filters: {
        requiredParameters: ['tools'],
      },
    };

    const filtered = service.filterModels(models, config);
    expect(filtered).toHaveLength(1);
  });

  it('should filter by max prompt cost', () => {
    const service = new ModelFilterService();
    const models = [
      createModel({ pricing: { prompt: '0.000003', completion: '0.000006' } }), // $3/M
      createModel({ pricing: { prompt: '0.00001', completion: '0.00002' } }), // $10/M
    ];

    const config: ModelConfig = {
      enableNewModels: true,
      disabledModels: [],
      disabledProviders: [],
      filters: {
        maxPromptCostPerMillion: 5.0,
      },
    };

    const filtered = service.filterModels(models, config);
    expect(filtered).toHaveLength(1);
  });

  it('should filter by max completion cost', () => {
    const service = new ModelFilterService();
    const models = [
      createModel({ pricing: { prompt: '0.000001', completion: '0.000003' } }), // $1/$3 per M
      createModel({ pricing: { prompt: '0.000001', completion: '0.00002' } }), // $1/$20 per M
    ];

    const config: ModelConfig = {
      enableNewModels: true,
      disabledModels: [],
      disabledProviders: [],
      filters: {
        maxCompletionCostPerMillion: 10.0,
      },
    };

    const filtered = service.filterModels(models, config);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].pricing.completion).toBe('0.000003');
  });

  it('should filter by context length', () => {
    const service = new ModelFilterService();
    const models = [createModel({ context_length: 4096 }), createModel({ context_length: 128000 })];

    const config: ModelConfig = {
      enableNewModels: true,
      disabledModels: [],
      disabledProviders: [],
      filters: {
        minContextLength: 32000,
      },
    };

    const filtered = service.filterModels(models, config);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].context_length).toBe(128000);
  });

  it('should apply multiple filters together', () => {
    const service = new ModelFilterService();
    const models = [
      createModel({
        id: 'openai/gpt-4',
        context_length: 128000,
        pricing: { prompt: '0.000003', completion: '0.000015' },
        supported_parameters: ['tools', 'vision'],
      }),
      createModel({
        id: 'anthropic/claude',
        context_length: 200000,
        pricing: { prompt: '0.00001', completion: '0.00005' }, // Too expensive
        supported_parameters: ['tools'],
      }),
      createModel({
        id: 'google/gemini',
        context_length: 32000,
        pricing: { prompt: '0.000001', completion: '0.000005' },
        supported_parameters: ['tools'],
      }),
    ];

    const config: ModelConfig = {
      enableNewModels: true,
      disabledModels: [],
      disabledProviders: ['google'], // Exclude Google
      filters: {
        requiredParameters: ['tools'],
        maxPromptCostPerMillion: 5.0,
        minContextLength: 100000,
      },
    };

    const filtered = service.filterModels(models, config);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('openai/gpt-4');
  });

  it('should handle models with missing optional fields', () => {
    const service = new ModelFilterService();
    const models = [
      createModel({
        supported_parameters: undefined, // Missing supported_parameters
      }),
    ];

    const config: ModelConfig = {
      enableNewModels: true,
      disabledModels: [],
      disabledProviders: [],
      filters: {
        requiredParameters: ['tools'], // Should filter out model without supported_parameters
      },
    };

    const filtered = service.filterModels(models, config);
    expect(filtered).toHaveLength(0);
  });

  it('should group models by provider', () => {
    const service = new ModelFilterService();
    const models = [
      createModel({ id: 'openai/gpt-4' }),
      createModel({ id: 'openai/gpt-3.5' }),
      createModel({ id: 'anthropic/claude-3' }),
      createModel({ id: 'google/gemini' }),
    ];

    const grouped = service.groupByProvider(models);

    expect(grouped.size).toBe(3);
    expect(grouped.get('openai')).toHaveLength(2);
    expect(grouped.get('anthropic')).toHaveLength(1);
    expect(grouped.get('google')).toHaveLength(1);
  });

  it('should handle models without provider in ID', () => {
    const service = new ModelFilterService();
    const models = [createModel({ id: 'standalone-model' }), createModel({ id: 'openai/gpt-4' })];

    const grouped = service.groupByProvider(models);

    expect(grouped.size).toBe(2);
    expect(grouped.get('unknown')).toHaveLength(1);
    expect(grouped.get('openai')).toHaveLength(1);
  });

  it('should return all models when no filters are applied', () => {
    const service = new ModelFilterService();
    const models = [createModel({ id: 'openai/gpt-4' }), createModel({ id: 'anthropic/claude' })];

    const config: ModelConfig = {
      enableNewModels: true,
      disabledModels: [],
      disabledProviders: [],
      // No filters
    };

    const filtered = service.filterModels(models, config);
    expect(filtered).toHaveLength(2);
  });

  it('should handle free models correctly', () => {
    const service = new ModelFilterService();
    const models = [
      createModel({ pricing: { prompt: '0', completion: '0' } }), // Free model
      createModel({ pricing: { prompt: '0.000001', completion: '0.000002' } }),
    ];

    const config: ModelConfig = {
      enableNewModels: true,
      disabledModels: [],
      disabledProviders: [],
      filters: {
        maxPromptCostPerMillion: 0, // Only free models
      },
    };

    const filtered = service.filterModels(models, config);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].pricing.prompt).toBe('0');
  });
});
