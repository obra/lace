// ABOUTME: Provider registry for managing available AI providers and their discovery
// ABOUTME: Handles provider registration and provides providers for agent execution

import { AIProvider, ProviderConfig } from '~/providers/base-provider';
import { getEnvVar } from '~/config/env-loader';
import { AnthropicProvider } from '~/providers/anthropic-provider';
import { OpenAIProvider } from '~/providers/openai-provider';
import { LMStudioProvider } from '~/providers/lmstudio-provider';
import { OllamaProvider } from '~/providers/ollama-provider';
import { ProviderCatalogManager } from '~/providers/catalog/manager';
import { ProviderInstanceManager } from '~/providers/instance/manager';
import type { CatalogProvider, CatalogModel, ProviderInstance } from '~/providers/catalog/types';

export interface ConfiguredInstance {
  id: string;
  displayName: string;
  catalogProviderId: string;
  endpoint?: string;
  timeout?: number;
  retryPolicy?: string;
  hasCredentials: boolean;
}

export class ProviderRegistry {
  private _providers = new Map<string, AIProvider>();
  private catalogManager: ProviderCatalogManager;
  private instanceManager: ProviderInstanceManager;
  private configuredInstances: Map<string, ProviderInstance> = new Map();

  constructor() {
    this.catalogManager = new ProviderCatalogManager();
    this.instanceManager = new ProviderInstanceManager();
  }

  async initialize(): Promise<void> {
    // Load catalog data
    await this.catalogManager.loadCatalogs();

    // Load user instances
    const config = await this.instanceManager.loadInstances();
    this.configuredInstances.clear();

    for (const [instanceId, instance] of Object.entries(config.instances)) {
      this.configuredInstances.set(instanceId, instance);
    }
  }

  getCatalogProviders(): CatalogProvider[] {
    return this.catalogManager.getAvailableProviders();
  }

  async getConfiguredInstances(): Promise<ConfiguredInstance[]> {
    const instances: ConfiguredInstance[] = [];

    for (const [instanceId, instance] of this.configuredInstances.entries()) {
      // Check if credentials exist without loading them
      const hasCredentials = (await this.instanceManager.loadCredential(instanceId)) !== null;

      instances.push({
        id: instanceId,
        displayName: instance.displayName,
        catalogProviderId: instance.catalogProviderId,
        endpoint: instance.endpoint,
        timeout: instance.timeout,
        retryPolicy: instance.retryPolicy,
        hasCredentials,
      });
    }

    return instances;
  }

  getModelFromCatalog(providerId: string, modelId: string): CatalogModel | null {
    return this.catalogManager.getModel(providerId, modelId);
  }

  async createProviderFromInstance(instanceId: string): Promise<AIProvider> {
    const instance = this.configuredInstances.get(instanceId);
    if (!instance) {
      throw new Error(`Provider instance not found: ${instanceId}`);
    }

    const credentials = await this.instanceManager.loadCredential(instanceId);
    if (!credentials) {
      throw new Error(`No credentials found for instance: ${instanceId}`);
    }

    const catalogProvider = this.catalogManager.getProvider(instance.catalogProviderId);
    if (!catalogProvider) {
      throw new Error(`Catalog provider not found: ${instance.catalogProviderId}`);
    }

    // Build provider config from instance and credentials
    const providerConfig: ProviderConfig = {
      apiKey: credentials.apiKey,
      ...(credentials.additionalAuth || {}),
      ...(instance.endpoint && { baseURL: instance.endpoint }),
      ...(instance.timeout && { timeout: instance.timeout }),
    };

    // Create provider using the existing createProvider method
    return this.createProvider(catalogProvider.type, providerConfig);
  }

  async createProviderFromInstanceAndModel(
    instanceId: string,
    modelId: string
  ): Promise<AIProvider> {
    const instance = this.configuredInstances.get(instanceId);
    if (!instance) {
      throw new Error(`Provider instance not found: ${instanceId}`);
    }

    const credentials = await this.instanceManager.loadCredential(instanceId);
    if (!credentials) {
      throw new Error(`No credentials found for instance: ${instanceId}`);
    }

    const catalogProvider = this.catalogManager.getProvider(instance.catalogProviderId);
    if (!catalogProvider) {
      throw new Error(`Catalog provider not found: ${instance.catalogProviderId}`);
    }

    // Verify model exists in catalog
    const model = this.getModelFromCatalog(instance.catalogProviderId, modelId);
    if (!model) {
      throw new Error(
        `Model not found in catalog: ${modelId} for provider ${instance.catalogProviderId}`
      );
    }

    // Build provider config with model
    const providerConfig: ProviderConfig = {
      model: modelId,
      apiKey: credentials.apiKey,
      ...(credentials.additionalAuth || {}),
      ...(instance.endpoint && { baseURL: instance.endpoint }),
      ...(instance.timeout && { timeout: instance.timeout }),
    };

    // Create provider using the existing createProvider method
    return this.createProvider(catalogProvider.type, providerConfig);
  }

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
