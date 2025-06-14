// ABOUTME: Mock factory for model definitions and instances used across tests
// ABOUTME: Provides standardized model configurations for Anthropic, OpenAI, and local models

import { jest } from "@jest/globals";

/**
 * Standard model definitions with pricing and capabilities
 */
export const MODEL_DEFINITIONS = {
  // Anthropic Models
  "claude-3-5-sonnet-20241022": {
    name: "claude-3-5-sonnet-20241022",
    provider: "anthropic",
    contextWindow: 200000,
    inputPrice: 3.0,
    outputPrice: 15.0,
    capabilities: ["chat", "tools", "vision"]
  },
  
  "claude-3-5-haiku-20241022": {
    name: "claude-3-5-haiku-20241022", 
    provider: "anthropic",
    contextWindow: 200000,
    inputPrice: 0.25,
    outputPrice: 1.25,
    capabilities: ["chat", "tools"]
  },
  
  "claude-3-haiku-20240307": {
    name: "claude-3-haiku-20240307",
    provider: "anthropic", 
    contextWindow: 200000,
    inputPrice: 0.25,
    outputPrice: 1.25,
    capabilities: ["chat", "tools"]
  },

  // OpenAI Models
  "gpt-4-turbo": {
    name: "gpt-4-turbo",
    provider: "openai",
    contextWindow: 128000,
    inputPrice: 10.0,
    outputPrice: 30.0,
    capabilities: ["chat", "tools", "vision"]
  },
  
  "gpt-3.5-turbo": {
    name: "gpt-3.5-turbo",
    provider: "openai",
    contextWindow: 16385,
    inputPrice: 0.5,
    outputPrice: 1.5,
    capabilities: ["chat", "tools"]
  }
};

/**
 * Create a mock model definition
 * @param {string} modelName - Name of the model
 * @param {object} overrides - Properties to override
 * @returns {object} Model definition object
 */
export function createMockModelDefinition(modelName = "claude-3-5-sonnet-20241022", overrides = {}) {
  const baseDefinition = MODEL_DEFINITIONS[modelName] || MODEL_DEFINITIONS["claude-3-5-sonnet-20241022"];
  
  return {
    ...baseDefinition,
    name: modelName, // Always use the requested model name
    ...overrides
  };
}

/**
 * Create a mock model instance with chat functionality
 * @param {string} modelName - Name of the model 
 * @param {object} options - Configuration options
 * @param {string} options.defaultResponse - Default chat response
 * @param {boolean} options.shouldSucceed - Whether chat calls should succeed
 * @param {object} options.definitionOverrides - Model definition overrides
 * @returns {object} Mock model instance
 */
export function createMockModelInstance(modelName = "claude-3-5-sonnet-20241022", options = {}) {
  const {
    defaultResponse = "Mock response",
    shouldSucceed = true,
    definitionOverrides = {}
  } = options;

  const definition = createMockModelDefinition(modelName, definitionOverrides);

  return {
    definition,
    chat: jest.fn().mockResolvedValue({
      success: shouldSucceed,
      content: defaultResponse,
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120
      }
    }),
    countTokens: jest.fn().mockResolvedValue({
      success: true,
      inputTokens: 100,
      outputTokens: 0,
      totalTokens: 100
    }),
    getContextWindow: jest.fn().mockReturnValue(definition.contextWindow)
  };
}

/**
 * Create a mock model provider
 * @param {string} providerName - Name of the provider (anthropic, openai, etc.)
 * @param {object} options - Configuration options
 * @returns {object} Mock model provider
 */
export function createMockModelProvider(providerName = "anthropic", options = {}) {
  const {
    defaultResponse = "Mock provider response",
    shouldSucceed = true
  } = options;

  return {
    name: providerName,
    initialize: jest.fn().mockResolvedValue(undefined),
    chat: jest.fn().mockResolvedValue({
      success: shouldSucceed,
      content: defaultResponse,
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 }
    }),
    countTokens: jest.fn().mockResolvedValue({
      success: true,
      inputTokens: 100,
      outputTokens: 0, 
      totalTokens: 100
    }),
    listModels: jest.fn().mockReturnValue(
      Object.keys(MODEL_DEFINITIONS).filter(name => 
        MODEL_DEFINITIONS[name].provider === providerName
      )
    ),
    getMetadata: jest.fn().mockReturnValue({
      name: providerName,
      description: `Mock ${providerName} provider`,
      supportedModels: {},
      capabilities: ['chat', 'tools']
    }),
    getInfo: jest.fn().mockReturnValue({ name: providerName }),
    getModelSession: jest.fn().mockImplementation((modelName) => {
      const instance = createMockModelInstance(modelName || "claude-3-5-sonnet-20241022", { 
        shouldSucceed,
        defaultResponse 
      });
      return instance;
    })
  };
}

/**
 * Create multiple model instances for testing
 * @param {Array<string>} modelNames - Array of model names to create
 * @param {object} globalOptions - Options applied to all instances
 * @returns {object} Object with model instances keyed by name
 */
export function createMockModelInstances(modelNames, globalOptions = {}) {
  const instances = {};
  
  for (const modelName of modelNames) {
    instances[modelName] = createMockModelInstance(modelName, globalOptions);
  }
  
  return instances;
}

/**
 * Create a mock model registry with pre-loaded models
 * @param {Array<string>} modelNames - Models to include in registry
 * @returns {object} Mock model registry
 */
export function createMockModelRegistry(modelNames = ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"]) {
  const models = {};
  const instances = {};
  
  for (const modelName of modelNames) {
    models[modelName] = createMockModelDefinition(modelName);
    instances[modelName] = createMockModelInstance(modelName);
  }

  return {
    initialize: jest.fn().mockResolvedValue(undefined),
    registerModel: jest.fn(),
    getModel: jest.fn((name) => models[name] || null),
    listModels: jest.fn().mockReturnValue(Object.keys(models)),
    createInstance: jest.fn((name, config) => instances[name] || createMockModelInstance(name, config)),
    validateModel: jest.fn().mockReturnValue(true),
    models,
    instances
  };
}

/**
 * Role-specific model configurations
 */
export const ROLE_MODEL_CONFIGS = {
  general: {
    defaultModel: "claude-3-5-sonnet-20241022",
    fallbackModel: "claude-3-5-haiku-20241022"
  },
  execution: {
    defaultModel: "claude-3-5-haiku-20241022", 
    fallbackModel: "claude-3-5-sonnet-20241022"
  },
  reasoning: {
    defaultModel: "claude-3-5-sonnet-20241022",
    fallbackModel: "claude-3-5-haiku-20241022"
  },
  planning: {
    defaultModel: "claude-3-5-sonnet-20241022",
    fallbackModel: "claude-3-5-haiku-20241022"
  }
};

/**
 * Get model configuration for a specific role
 * @param {string} role - Agent role
 * @returns {object} Model configuration for the role
 */
export function getModelConfigForRole(role) {
  return ROLE_MODEL_CONFIGS[role] || ROLE_MODEL_CONFIGS.general;
}