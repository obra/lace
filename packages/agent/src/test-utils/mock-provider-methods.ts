// ABOUTME: Common mock implementations for provider metadata methods
// ABOUTME: Used by BaseMockProvider and other test utilities

export const mockProviderMethods = {
  getProviderInfo: () => ({
    name: 'mock',
    displayName: 'Mock Provider',
    requiresApiKey: false,
    configurationHint: 'Mock provider for testing',
  }),

  getAvailableModels: () => [
    {
      id: 'mock-model',
      displayName: 'Mock Model',
      contextWindow: 100000,
      maxOutputTokens: 4096,
      isDefault: true,
    },
  ],

  isConfigured: () => true,
};
