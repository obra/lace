// ABOUTME: Provider registry for managing available AI providers and their discovery
// ABOUTME: Handles provider registration and provides providers for agent execution

import { AIProvider, ProviderConfig } from '~/providers/base-provider';
import { getEnvVar } from '~/config/env-loader';
import { AnthropicProvider } from '~/providers/anthropic-provider';
import { OpenAIProvider } from '~/providers/openai-provider';
import { LMStudioProvider } from '~/providers/lmstudio-provider';
import { OllamaProvider } from '~/providers/ollama-provider';

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

  // Get all available provider metadata
  getAvailableProviders(): Array<{
    info: import('./base-provider').ProviderInfo;
    models: import('./base-provider').ModelInfo[];
    configured: boolean;
  }> {
    const providers = ['anthropic', 'openai', 'lmstudio', 'ollama'];
    const results = [];

    for (const providerName of providers) {
      try {
        // Try to create provider instance to check configuration
        const provider = this.createProvider(providerName);
        const info = provider.getProviderInfo();
        const models = provider.getAvailableModels();
        const configured = provider.isConfigured();

        // Clean up provider
        provider.cleanup();

        results.push({ info, models, configured });
      } catch {
        // Provider not configured - still return info
        const tempProvider = this.getProviderClass(providerName);
        if (tempProvider) {
          const info = tempProvider.getProviderInfo();
          const models = tempProvider.getAvailableModels();
          results.push({ info, models, configured: false });
        }
      }
    }

    return results;
  }

  // Helper to get provider class without full instantiation
  private getProviderClass(providerName: string): AIProvider | null {
    try {
      switch (providerName.toLowerCase()) {
        case 'anthropic': {
          // Create temporary instance for metadata access only - not for API calls
          return new AnthropicProvider({ apiKey: 'dummy' });
        }
        case 'openai': {
          // Create temporary instance for metadata access only - not for API calls
          return new OpenAIProvider({ apiKey: 'dummy' });
        }
        case 'lmstudio': {
          return new LMStudioProvider({ baseURL: 'http://localhost:1234' });
        }
        case 'ollama': {
          return new OllamaProvider({ baseURL: 'http://localhost:11434' });
        }
        default:
          return null;
      }
    } catch {
      return null;
    }
  }

  createProvider(providerName: string, config: ProviderConfig = {}): AIProvider {
    // Use static imports for better build performance
    switch (providerName.toLowerCase()) {
      case 'anthropic': {
        const apiKey = (config.apiKey as string) || getEnvVar('ANTHROPIC_KEY');
        return new AnthropicProvider({ ...config, apiKey: apiKey || null });
      }
      case 'openai': {
        const apiKey =
          (config.apiKey as string) || getEnvVar('OPENAI_API_KEY') || getEnvVar('OPENAI_KEY');
        return new OpenAIProvider({ ...config, apiKey: apiKey || null });
      }
      case 'lmstudio': {
        return new LMStudioProvider(config);
      }
      case 'ollama': {
        return new OllamaProvider(config);
      }
      case 'test-provider': {
        // Mock provider needs to be handled differently for tests
        throw new Error('Test provider not supported in production builds');
      }
      default:
        throw new Error(
          `Unknown provider: ${providerName}. Available providers: ${this.getProviderNames().join(', ')}`
        );
    }
  }

  static createWithAutoDiscovery(): ProviderRegistry {
    const registry = new ProviderRegistry();

    // Static list of known providers - no dynamic imports needed
    const providerClasses = [AnthropicProvider, OpenAIProvider, LMStudioProvider, OllamaProvider];

    for (const ProviderClass of providerClasses) {
      try {
        // Create instance with minimal config for discovery
        let provider: AIProvider;
        try {
          // Try with minimal config for each provider type
          if (ProviderClass === AnthropicProvider) {
            provider = new ProviderClass({ apiKey: 'discovery-mode-placeholder' });
          } else if (ProviderClass === OpenAIProvider) {
            provider = new ProviderClass({ apiKey: 'discovery-mode-placeholder' });
          } else if (ProviderClass === LMStudioProvider) {
            provider = new ProviderClass({ baseURL: 'http://localhost:1234' });
          } else if (ProviderClass === OllamaProvider) {
            provider = new ProviderClass({ baseURL: 'http://localhost:11434' });
          } else {
            // Fallback for unknown providers
            provider = new ProviderClass({ apiKey: 'discovery-mode-placeholder' });
          }
        } catch {
          // Skip providers that can't be instantiated
          try {
            // Last resort fallback
            provider = new ProviderClass({ apiKey: 'discovery-mode-placeholder' });
          } catch {
            // Skip providers that can't be instantiated even with placeholder config
            continue;
          }
        }

        registry.registerProvider(provider);
      } catch {
        // Skip providers that can't be registered
      }
    }

    return registry;
  }

  static isProviderClass(value: unknown): boolean {
    // Check if it's a constructor function/class
    if (typeof value !== 'function') return false;
    if (!value.prototype) return false;
    // Check if the class name ends with "Provider" (simple heuristic)
    if (!value.name || !value.name.endsWith('Provider')) return false;
    // Check if it extends AIProvider by checking the prototype chain
    let proto = value.prototype as unknown;
    while (proto) {
      if ((proto as { constructor: { name: string } }).constructor.name === 'AIProvider')
        return true;
      proto = Object.getPrototypeOf(proto);
    }
    return false;
  }
}
