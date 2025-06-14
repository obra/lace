// ABOUTME: Provider registry for managing available AI providers and their discovery
// ABOUTME: Handles provider registration and provides providers for agent execution

import { AIProvider } from './types.js';

export class ProviderRegistry {
  private _providers = new Map<string, AIProvider>();

  registerProvider(provider: AIProvider): void {
    this._providers.set(provider.providerName, provider);
  }

  getProvider(name: string): AIProvider | undefined {
    return this._providers.get(name);
  }

  getAllProviders(): AIProvider[] {
    return Array.from(this._providers.values());
  }

  getProviderNames(): string[] {
    return Array.from(this._providers.keys());
  }
}
