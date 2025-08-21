// ABOUTME: Shared mock implementations for provider metadata methods
// ABOUTME: Used by test providers to satisfy the abstract base class requirements

import type { ProviderInfo, ModelInfo } from '~/providers/base-provider';

const mockProviderInfo: ProviderInfo = {
  name: 'test',
  displayName: 'Test Provider',
  requiresApiKey: false,
  configurationHint: 'No configuration needed for tests',
};

const mockModelInfo: ModelInfo[] = [
  {
    id: 'test-model',
    displayName: 'Test Model',
    description: 'Model for testing',
    contextWindow: 4096,
    maxOutputTokens: 2048,
    capabilities: ['function-calling'],
    isDefault: true,
  },
];

export const mockProviderMethods = {
  getProviderInfo(): ProviderInfo {
    return mockProviderInfo;
  },

  getAvailableModels(): ModelInfo[] {
    return mockModelInfo;
  },

  isConfigured(): boolean {
    return true;
  },
};
