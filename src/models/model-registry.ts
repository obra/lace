// ABOUTME: Model registry that manages all available model providers and definitions for the system
// ABOUTME: Registry for provider registration/retrieval and model definition storage

import { ModelDefinition } from './model-definition.js';

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

  /**
   * Optional methods for enhanced functionality
   */
  getContextWindow?(model: string): number;
  calculateCost?(model: string, inputTokens: number, outputTokens: number): any;
  getContextUsage?(model: string, totalTokens: number): any;
  
  /**
   * Context optimization methods
   */
  optimizeMessages?(messages: any[], options?: any): Promise<any[]>;
  applyCaching?(messages: any[]): any[];
  countTokens?(messages: any[], options?: any): Promise<any>;
}

/**
 * Model registry that manages all available model providers and definitions
 */
export class ModelRegistry {
  private providers: Map<string, BaseModelProvider>;
  private modelDefinitions: Map<string, ModelDefinition>;

  constructor() {
    this.providers = new Map();
    this.modelDefinitions = new Map();
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

  /**
   * Register a model definition in the registry
   */
  registerModelDefinition(name: string, definition: ModelDefinition): void {
    this.modelDefinitions.set(name, definition);
  }

  /**
   * Get a model definition by name
   */
  getModelDefinition(name: string): ModelDefinition | undefined {
    return this.modelDefinitions.get(name);
  }

  /**
   * Check if a model definition exists in the registry
   */
  hasModelDefinition(name: string): boolean {
    return this.modelDefinitions.has(name);
  }

  /**
   * Get all registered model definition names
   */
  listModelDefinitions(): string[] {
    return Array.from(this.modelDefinitions.keys());
  }

  /**
   * Get all model definitions as an array
   */
  getAllModelDefinitions(): ModelDefinition[] {
    return Array.from(this.modelDefinitions.values());
  }
}

// Create the default registry instance
export const modelRegistry = new ModelRegistry();