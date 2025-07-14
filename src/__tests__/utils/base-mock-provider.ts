// ABOUTME: Base class for mock providers that implements required metadata methods
// ABOUTME: Extend this class in tests to avoid boilerplate

import { AIProvider } from '~/providers/base-provider';
import { mockProviderMethods } from '~/__tests__/utils/mock-provider-methods';

export abstract class BaseMockProvider extends AIProvider {
  // Add mock provider methods as bound arrow functions
  getProviderInfo = () => mockProviderMethods.getProviderInfo();
  getAvailableModels = () => mockProviderMethods.getAvailableModels();
  isConfigured = () => mockProviderMethods.isConfigured();
}
