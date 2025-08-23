// ABOUTME: Provider registry for managing available AI providers and their discovery
// ABOUTME: Handles provider registration and provides providers for agent execution

import { AIProvider, ProviderConfig, ProviderInfo, ModelInfo } from '~/providers/base-provider';
import { AnthropicProvider } from '~/providers/anthropic-provider';
import { OpenAIProvider } from '~/providers/openai-provider';
import { LMStudioProvider } from '~/providers/lmstudio-provider';
import { OllamaProvider } from '~/providers/ollama-provider';
import { ProviderCatalogManager } from '~/providers/catalog/manager';
import { ProviderInstanceManager } from '~/providers/instance/manager';
import type { CatalogProvider, CatalogModel } from '~/providers/catalog/types';
import { logger } from '~/utils/logger';

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
  private static instance: ProviderRegistry | null = null;
  private static initializationPromise: Promise<void> | null = null;

  private _providers = new Map<string, AIProvider>();
  private catalogManager: ProviderCatalogManager;
  private instanceManager: ProviderInstanceManager;
  private isInitialized = false;

  private constructor() {
    this.catalogManager = new ProviderCatalogManager();
    this.instanceManager = new ProviderInstanceManager();
  }

  static getInstance(): ProviderRegistry {
    if (!ProviderRegistry.instance) {
      ProviderRegistry.instance = new ProviderRegistry();
      // Start initialization immediately (fire and forget)
      void ProviderRegistry.instance.ensureInitialized();
    }
    return ProviderRegistry.instance;
  }

  static clearInstance(): void {
    ProviderRegistry.instance = null;
    ProviderRegistry.initializationPromise = null;
  }

  async ensureInitialized(): Promise<void> {
    // If already initialized, return immediately
    if (this.isInitialized) {
      return;
    }

    // If initialization is in progress, wait for it
    if (ProviderRegistry.initializationPromise) {
      return ProviderRegistry.initializationPromise;
    }

    // Start initialization
    ProviderRegistry.initializationPromise = this.doInitialize();
    await ProviderRegistry.initializationPromise;
    ProviderRegistry.initializationPromise = null;
  }

  private async doInitialize(): Promise<void> {
    // Only load catalog data - instances are loaded on demand
    await this.catalogManager.loadCatalogs();
    this.isInitialized = true;
  }

  async getCatalogProviders(): Promise<CatalogProvider[]> {
    await this.ensureInitialized();
    return this.catalogManager.getAvailableProviders();
  }

  async getConfiguredInstances(): Promise<ConfiguredInstance[]> {
    await this.ensureInitialized();

    // Load instances fresh from disk every time
    const config = await this.instanceManager.loadInstances();
    const instances: ConfiguredInstance[] = [];

    for (const [instanceId, instance] of Object.entries(config.instances)) {
      // Check if credentials exist without loading them
      const hasCredentials = this.instanceManager.loadCredential(instanceId) !== null;

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

  async getModelFromCatalog(providerId: string, modelId: string): Promise<CatalogModel | null> {
    await this.ensureInitialized();
    return this.catalogManager.getModel(providerId, modelId);
  }

  async createProviderFromInstance(instanceId: string): Promise<AIProvider> {
    await this.ensureInitialized();

    // Load fresh instance data
    const config = await this.instanceManager.loadInstances();
    const instance = config.instances[instanceId];
    if (!instance) {
      throw new Error(`Provider instance not found: ${instanceId}`);
    }

    const credentials = this.instanceManager.loadCredential(instanceId);
    if (credentials == null) {
      throw new Error(`No credentials found for instance: ${instanceId}`);
    }

    const catalogProvider = this.catalogManager.getProvider(instance.catalogProviderId);
    if (!catalogProvider) {
      throw new Error(`Catalog provider not found: ${instance.catalogProviderId}`);
    }

    // Build provider config from instance and credentials
    // Priority: instance.endpoint > catalog.api_endpoint > provider default
    const baseURL = instance.endpoint || catalogProvider.api_endpoint;
    const providerConfig: ProviderConfig = {
      apiKey: credentials.apiKey,
      ...(credentials.additionalAuth || {}),
      ...(baseURL && { baseURL }),
      ...(instance.timeout && { timeout: instance.timeout }),
    };

    // Create provider using the existing createProvider method
    return this.createProvider(catalogProvider.type, providerConfig);
  }

  async createProviderFromInstanceAndModel(
    instanceId: string,
    modelId: string
  ): Promise<AIProvider> {
    await this.ensureInitialized();

    // Load fresh instance data
    const config = await this.instanceManager.loadInstances();
    const instance = config.instances[instanceId];
    if (!instance) {
      throw new Error(`Provider instance not found: ${instanceId}`);
    }

    const credentials = this.instanceManager.loadCredential(instanceId);
    if (credentials == null) {
      throw new Error(`No credentials found for instance: ${instanceId}`);
    }

    const catalogProvider = this.catalogManager.getProvider(instance.catalogProviderId);
    if (!catalogProvider) {
      throw new Error(`Catalog provider not found: ${instance.catalogProviderId}`);
    }

    // Verify model exists in catalog
    const model = await this.getModelFromCatalog(instance.catalogProviderId, modelId);
    if (!model) {
      throw new Error(
        `Model not found in catalog: ${modelId} for provider ${instance.catalogProviderId}`
      );
    }

    // Build provider config with model
    // Priority: instance.endpoint > catalog.api_endpoint (with env expansion) > provider default
    const baseURL = instance.endpoint || expandEnvVar(catalogProvider.api_endpoint);
    const providerConfig: ProviderConfig = {
      model: modelId,
      apiKey: credentials.apiKey,
      ...(credentials.additionalAuth || {}),
      ...(baseURL && { baseURL }),
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
    info: ProviderInfo;
    models: ModelInfo[];
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
        const tempProvider = this.getProviderForMetadata(providerName);
        if (tempProvider) {
          const info = tempProvider.getProviderInfo();
          const models = tempProvider.getAvailableModels();
          results.push({ info, models, configured: false });
        }
      }
    }

    return results;
  }

  // Helper to get provider instance for metadata without full instantiation
  private getProviderForMetadata(providerName: string): AIProvider | null {
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

  /**
   * Internal method to create a provider directly.
   * @internal This should only be used by agents for provider creation.
   * All other code should use createProviderFromInstance or createProviderFromInstanceAndModel.
   */
  createProvider(providerName: string, config: ProviderConfig = {}): AIProvider {
    logger.debug('ProviderRegistry.createProvider called', {
      providerName,
      hasApiKey: !!config.apiKey,
      configKeys: Object.keys(config),
    });

    // Use static imports for better build performance
    switch (providerName.toLowerCase()) {
      case 'anthropic': {
        logger.debug('Creating AnthropicProvider', {
          hasApiKey: !!config.apiKey,
        });
        return new AnthropicProvider({
          ...config,
          apiKey: (config.apiKey as string) || null,
        });
      }
      case 'openai': {
        logger.debug('Creating OpenAIProvider', {
          hasApiKey: !!config.apiKey,
        });
        return new OpenAIProvider({
          ...config,
          apiKey: (config.apiKey as string) || null,
        });
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
