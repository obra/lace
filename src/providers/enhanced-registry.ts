// ABOUTME: Enhanced provider registry with catalog and instance support
// ABOUTME: Integrates catalog system with existing provider registry functionality

import { ProviderRegistry } from '~/providers/registry';
import { ProviderCatalogManager } from '~/providers/catalog/manager';
import { ProviderInstanceManager } from '~/providers/instance/manager';
import { AIProvider, ProviderConfig } from '~/providers/base-provider';
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

export class EnhancedProviderRegistry extends ProviderRegistry {
  private catalogManager: ProviderCatalogManager;
  private instanceManager: ProviderInstanceManager;
  private configuredInstances: Map<string, ProviderInstance> = new Map();

  constructor() {
    super();
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

  getConfiguredInstances(): ConfiguredInstance[] {
    const instances: ConfiguredInstance[] = [];

    for (const [instanceId, instance] of this.configuredInstances.entries()) {
      instances.push({
        id: instanceId,
        displayName: instance.displayName,
        catalogProviderId: instance.catalogProviderId,
        endpoint: instance.endpoint,
        timeout: instance.timeout,
        retryPolicy: instance.retryPolicy,
        hasCredentials: false, // TODO: Check credentials without loading them
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

    // Create provider using the base registry's createProvider method
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

    // Create provider using the base registry's createProvider method
    return this.createProvider(catalogProvider.type, providerConfig);
  }

  // Maintain backward compatibility by extending base methods
  override createProvider(providerName: string, config: ProviderConfig = {}): AIProvider {
    // Use the parent implementation for backward compatibility
    return super.createProvider(providerName, config);
  }
}
