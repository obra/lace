// ABOUTME: Unit tests for ModelDefinition interface and related functionality
// ABOUTME: Tests static metadata validation, structure, and typing for AI model definitions

import { describe, it, expect } from '@jest/globals';
import { ModelDefinition } from '../../../src/models/model-definition.js';

describe('ModelDefinition', () => {
  it('should have all required properties', () => {
    const definition: ModelDefinition = {
      name: 'claude-3-5-sonnet-20241022',
      provider: 'anthropic',
      contextWindow: 200000,
      inputPrice: 3.0,
      outputPrice: 15.0,
      capabilities: ['chat', 'tools', 'vision']
    };

    expect(definition.name).toBe('claude-3-5-sonnet-20241022');
    expect(definition.provider).toBe('anthropic');
    expect(definition.contextWindow).toBe(200000);
    expect(definition.inputPrice).toBe(3.0);
    expect(definition.outputPrice).toBe(15.0);
    expect(definition.capabilities).toEqual(['chat', 'tools', 'vision']);
  });

  it('should support different capability sets', () => {
    const basicModel: ModelDefinition = {
      name: 'gpt-3.5-turbo',
      provider: 'openai',
      contextWindow: 16385,
      inputPrice: 0.5,
      outputPrice: 1.5,
      capabilities: ['chat']
    };

    const advancedModel: ModelDefinition = {
      name: 'gpt-4-vision-preview',
      provider: 'openai',
      contextWindow: 128000,
      inputPrice: 10.0,
      outputPrice: 30.0,
      capabilities: ['chat', 'tools', 'vision', 'json']
    };

    expect(basicModel.capabilities).toEqual(['chat']);
    expect(advancedModel.capabilities).toEqual(['chat', 'tools', 'vision', 'json']);
  });

  it('should support various pricing models', () => {
    const freeModel: ModelDefinition = {
      name: 'local-llama',
      provider: 'local',
      contextWindow: 4096,
      inputPrice: 0,
      outputPrice: 0,
      capabilities: ['chat']
    };

    const expensiveModel: ModelDefinition = {
      name: 'gpt-4-32k',
      provider: 'openai',
      contextWindow: 32768,
      inputPrice: 60.0,
      outputPrice: 120.0,
      capabilities: ['chat', 'tools']
    };

    expect(freeModel.inputPrice).toBe(0);
    expect(freeModel.outputPrice).toBe(0);
    expect(expensiveModel.inputPrice).toBe(60.0);
    expect(expensiveModel.outputPrice).toBe(120.0);
  });
});