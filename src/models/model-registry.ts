// ABOUTME: Model registry that manages all available model providers for the system
// ABOUTME: Simple registry for provider registration and retrieval

/**
 * Model provider metadata interface
 */
export interface ModelProviderMetadata {
  name: string;
  description: string;
  usage_guidance?: string;
  supportedModels: Record<string, any>;
  capabilities: string[];
  defaultModel?: string;
  [key: string]: any;
}

/**
 * Base interface that all model providers must implement
 */
export interface BaseModelProvider {
  /**
   * Initialize the provider
   */
  initialize(): Promise<void>;

  /**
   * Main chat interface
   */
  chat(messages: any[], options?: any): Promise<any>;

  /**
   * Get provider information
   */
  getInfo(): any;

  /**
   * Get comprehensive metadata about this provider
   */
  getMetadata(): ModelProviderMetadata;
}

/**
 * Model registry that manages all available model providers
 */
export class ModelRegistry {
  private providers: Map<string, BaseModelProvider>;

  constructor() {
    this.providers = new Map();
  }

  /**
   * Register a new provider in the registry
   */
  registerProvider(name: string, provider: BaseModelProvider): void {
    this.providers.set(name, provider);
  }

  /**
   * Get a provider by name
   */
  getProvider(name: string): BaseModelProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * Check if a provider exists in the registry
   */
  hasProvider(name: string): boolean {
    return this.providers.has(name);
  }

  /**
   * Get all registered provider names
   */
  listProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Get all providers as an array
   */
  getAllProviders(): BaseModelProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get metadata for all providers
   */
  getAllProviderMetadata(): ModelProviderMetadata[] {
    return this.getAllProviders().map(provider => provider.getMetadata());
  }
}

// Create the default registry instance
export const modelRegistry = new ModelRegistry();