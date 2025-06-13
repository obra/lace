// ABOUTME: Unit tests for ModelRegistry class and model definition storage/retrieval
// ABOUTME: Tests registry functionality for both providers and model definitions

import { describe, it, expect, jest } from '@jest/globals';
import { ModelRegistry, BaseModelProvider, ModelProviderMetadata } from '../../../src/models/model-registry.js';
import { ModelDefinition } from '../../../src/models/model-definition.js';

describe('ModelRegistry', () => {
  let registry: ModelRegistry;

  beforeEach(() => {
    registry = new ModelRegistry();
  });

  describe('provider management', () => {
    const mockProvider: BaseModelProvider = {
      initialize: jest.fn().mockImplementation(() => Promise.resolve()),
      chat: jest.fn().mockImplementation(() => Promise.resolve({ role: 'assistant', content: 'response' })),
      getInfo: jest.fn().mockReturnValue({ name: 'test-provider' }),
      getMetadata: jest.fn().mockReturnValue({
        name: 'test-provider',
        description: 'Test provider',
        supportedModels: {},
        capabilities: []
      })
    } as BaseModelProvider;

    it('should register and retrieve providers', () => {
      registry.registerProvider('test', mockProvider);
      
      expect(registry.hasProvider('test')).toBe(true);
      expect(registry.getProvider('test')).toBe(mockProvider);
    });

    it('should list registered providers', () => {
      registry.registerProvider('provider1', mockProvider);
      registry.registerProvider('provider2', mockProvider);
      
      const providers = registry.listProviders();
      expect(providers).toContain('provider1');
      expect(providers).toContain('provider2');
      expect(providers).toHaveLength(2);
    });

    it('should get all providers', () => {
      registry.registerProvider('test', mockProvider);
      
      const allProviders = registry.getAllProviders();
      expect(allProviders).toContain(mockProvider);
      expect(allProviders).toHaveLength(1);
    });

    it('should get all provider metadata', () => {
      registry.registerProvider('test', mockProvider);
      
      const metadata = registry.getAllProviderMetadata();
      expect(metadata).toHaveLength(1);
      expect(mockProvider.getMetadata).toHaveBeenCalled();
    });
  });

  describe('model definition management', () => {
    const mockDefinition: ModelDefinition = {
      name: 'claude-3-5-sonnet-20241022',
      provider: 'anthropic',
      contextWindow: 200000,
      inputPrice: 3.0,
      outputPrice: 15.0,
      capabilities: ['chat', 'tools', 'vision']
    };

    it('should register and retrieve model definitions', () => {
      registry.registerModelDefinition('claude-3-5-sonnet-20241022', mockDefinition);
      
      expect(registry.hasModelDefinition('claude-3-5-sonnet-20241022')).toBe(true);
      expect(registry.getModelDefinition('claude-3-5-sonnet-20241022')).toBe(mockDefinition);
    });

    it('should return undefined for non-existent model definitions', () => {
      expect(registry.getModelDefinition('non-existent')).toBeUndefined();
      expect(registry.hasModelDefinition('non-existent')).toBe(false);
    });

    it('should list registered model definitions', () => {
      registry.registerModelDefinition('model1', mockDefinition);
      registry.registerModelDefinition('model2', { ...mockDefinition, name: 'model2' });
      
      const models = registry.listModelDefinitions();
      expect(models).toContain('model1');
      expect(models).toContain('model2');
      expect(models).toHaveLength(2);
    });

    it('should get all model definitions', () => {
      registry.registerModelDefinition('test-model', mockDefinition);
      
      const allDefinitions = registry.getAllModelDefinitions();
      expect(allDefinitions).toContain(mockDefinition);
      expect(allDefinitions).toHaveLength(1);
    });

    it('should handle multiple model definitions from different providers', () => {
      const anthropicModel: ModelDefinition = {
        name: 'claude-3-5-sonnet-20241022',
        provider: 'anthropic',
        contextWindow: 200000,
        inputPrice: 3.0,
        outputPrice: 15.0,
        capabilities: ['chat', 'tools', 'vision']
      };

      const openaiModel: ModelDefinition = {
        name: 'gpt-4-turbo',
        provider: 'openai',
        contextWindow: 128000,
        inputPrice: 10.0,
        outputPrice: 30.0,
        capabilities: ['chat', 'tools', 'vision']
      };

      registry.registerModelDefinition('claude-3-5-sonnet-20241022', anthropicModel);
      registry.registerModelDefinition('gpt-4-turbo', openaiModel);

      expect(registry.listModelDefinitions()).toHaveLength(2);
      expect(registry.getModelDefinition('claude-3-5-sonnet-20241022')?.provider).toBe('anthropic');
      expect(registry.getModelDefinition('gpt-4-turbo')?.provider).toBe('openai');
    });
  });
});