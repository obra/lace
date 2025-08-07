// ABOUTME: Tests for provider catalog and instance types
// ABOUTME: Validates Catwalk catalog format and user instance configuration schemas

import { describe, it, expect } from 'vitest';
import {
  CatalogModelSchema,
  CatalogProviderSchema,
  ProviderInstanceSchema,
  ProviderInstancesConfigSchema,
  CredentialSchema,
} from '~/providers/catalog/types';

describe('CatalogModelSchema', () => {
  it('validates a basic model from Catwalk data', () => {
    const validModel = {
      id: 'claude-3-5-sonnet-20241022',
      name: 'Claude 3.5 Sonnet',
      cost_per_1m_in: 3.0,
      cost_per_1m_out: 15.0,
      context_window: 200000,
      default_max_tokens: 8192,
    };

    const result = CatalogModelSchema.safeParse(validModel);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validModel);
    }
  });

  it('validates a model with optional cached pricing', () => {
    const modelWithCached = {
      id: 'claude-sonnet-4-20250514',
      name: 'Claude Sonnet 4',
      cost_per_1m_in: 3.0,
      cost_per_1m_out: 15.0,
      cost_per_1m_in_cached: 3.75,
      cost_per_1m_out_cached: 0.3,
      context_window: 200000,
      default_max_tokens: 50000,
      can_reason: true,
      supports_attachments: true,
    };

    const result = CatalogModelSchema.safeParse(modelWithCached);
    expect(result.success).toBe(true);
  });

  it('rejects model without required fields', () => {
    const invalidModel = {
      id: 'test-model',
      name: 'Test Model',
      // Missing required cost and context fields
    };

    const result = CatalogModelSchema.safeParse(invalidModel);
    expect(result.success).toBe(false);
  });

  it('rejects model with invalid cost values', () => {
    const invalidModel = {
      id: 'test-model',
      name: 'Test Model',
      cost_per_1m_in: -1, // Negative cost
      cost_per_1m_out: 15.0,
      context_window: 200000,
      default_max_tokens: 8192,
    };

    const result = CatalogModelSchema.safeParse(invalidModel);
    expect(result.success).toBe(false);
  });
});

describe('CatalogProviderSchema', () => {
  it('validates Anthropic provider from Catwalk data', () => {
    const anthropicProvider = {
      name: 'Anthropic',
      id: 'anthropic',
      type: 'anthropic',
      api_key: '$ANTHROPIC_API_KEY',
      api_endpoint: '$ANTHROPIC_API_ENDPOINT',
      default_large_model_id: 'claude-sonnet-4-20250514',
      default_small_model_id: 'claude-3-5-haiku-20241022',
      models: [
        {
          id: 'claude-3-5-sonnet-20241022',
          name: 'Claude 3.5 Sonnet',
          cost_per_1m_in: 3.0,
          cost_per_1m_out: 15.0,
          context_window: 200000,
          default_max_tokens: 8192,
        },
      ],
    };

    const result = CatalogProviderSchema.safeParse(anthropicProvider);
    expect(result.success).toBe(true);
  });

  it('validates provider with minimal required fields', () => {
    const minimalProvider = {
      name: 'Test Provider',
      id: 'test',
      type: 'openai',
      default_large_model_id: 'gpt-4',
      default_small_model_id: 'gpt-3.5-turbo',
      models: [],
    };

    const result = CatalogProviderSchema.safeParse(minimalProvider);
    expect(result.success).toBe(true);
  });

  it('rejects provider without required fields', () => {
    const invalidProvider = {
      name: 'Test Provider',
      id: 'test',
      // Missing required type and model fields
    };

    const result = CatalogProviderSchema.safeParse(invalidProvider);
    expect(result.success).toBe(false);
  });
});

describe('ProviderInstanceSchema', () => {
  it('validates basic provider instance', () => {
    const validInstance = {
      displayName: 'OpenAI Production',
      catalogProviderId: 'openai',
    };

    const result = ProviderInstanceSchema.safeParse(validInstance);
    expect(result.success).toBe(true);
  });

  it('validates instance with optional configuration', () => {
    const instanceWithConfig = {
      displayName: 'Local Ollama',
      catalogProviderId: 'ollama',
      endpoint: 'http://localhost:11434',
      timeout: 30000,
      retryPolicy: 'exponential',
    };

    const result = ProviderInstanceSchema.safeParse(instanceWithConfig);
    expect(result.success).toBe(true);
  });

  it('rejects instance with empty display name', () => {
    const invalidInstance = {
      displayName: '',
      catalogProviderId: 'openai',
    };

    const result = ProviderInstanceSchema.safeParse(invalidInstance);
    expect(result.success).toBe(false);
  });

  it('rejects instance with invalid endpoint URL', () => {
    const invalidInstance = {
      displayName: 'Test Instance',
      catalogProviderId: 'openai',
      endpoint: 'not-a-url',
    };

    const result = ProviderInstanceSchema.safeParse(invalidInstance);
    expect(result.success).toBe(false);
  });
});

describe('ProviderInstancesConfigSchema', () => {
  it('validates empty configuration', () => {
    const emptyConfig = {
      version: '1.0' as const,
      instances: {},
    };

    const result = ProviderInstancesConfigSchema.safeParse(emptyConfig);
    expect(result.success).toBe(true);
  });

  it('validates configuration with multiple instances', () => {
    const configWithInstances = {
      version: '1.0' as const,
      instances: {
        'openai-prod': {
          displayName: 'OpenAI Production',
          catalogProviderId: 'openai',
        },
        'anthropic-dev': {
          displayName: 'Anthropic Development',
          catalogProviderId: 'anthropic',
          endpoint: 'https://api.anthropic.com/v1',
          timeout: 60000,
        },
      },
    };

    const result = ProviderInstancesConfigSchema.safeParse(configWithInstances);
    expect(result.success).toBe(true);
  });

  it('rejects configuration with wrong version', () => {
    const invalidConfig = {
      version: '2.0', // Wrong version
      instances: {},
    };

    const result = ProviderInstancesConfigSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
  });
});

describe('CredentialSchema', () => {
  it('validates basic credential', () => {
    const validCredential = {
      apiKey: 'sk-test123',
    };

    const result = CredentialSchema.safeParse(validCredential);
    expect(result.success).toBe(true);
  });

  it('validates credential with additional auth', () => {
    const credentialWithAuth = {
      apiKey: 'sk-test123',
      additionalAuth: {
        orgId: 'org-123',
        region: 'us-east-1',
      },
    };

    const result = CredentialSchema.safeParse(credentialWithAuth);
    expect(result.success).toBe(true);
  });

  it('rejects credential with empty API key', () => {
    const invalidCredential = {
      apiKey: '',
    };

    const result = CredentialSchema.safeParse(invalidCredential);
    expect(result.success).toBe(false);
  });
});
