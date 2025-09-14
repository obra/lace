// ABOUTME: Manages user provider instances and credential storage
// ABOUTME: Handles provider-instances.json and credentials directory

import * as fs from 'fs';
import * as path from 'path';
import { getLaceDir } from '~/config/lace-dir';
import { getEnvVar } from '~/config/env-loader';
import {
  ProviderInstancesConfig,
  ProviderInstancesConfigSchema,
  Credential,
  CredentialSchema,
  ProviderInstance,
} from '~/providers/catalog/types';
import { ProviderRegistry } from '~/providers/registry';
import { AIProvider } from '~/providers/base-provider';

export class ProviderInstanceManager {
  private configPath: string;
  private credentialsDir: string;
  private savePromise: Promise<void> | null = null;

  constructor() {
    const laceDir = getLaceDir();
    this.configPath = path.join(laceDir, 'provider-instances.json');
    this.credentialsDir = path.join(laceDir, 'credentials');
  }

  async loadInstances(): Promise<ProviderInstancesConfig> {
    try {
      const content = await fs.promises.readFile(this.configPath, 'utf-8');
      const parsed = JSON.parse(content) as unknown;
      const result = ProviderInstancesConfigSchema.safeParse(parsed);

      if (result.success) {
        return result.data;
      } else {
        console.warn('Invalid provider instances config, using default:', result.error);
        return this.getDefaultConfig();
      }
    } catch (_error) {
      // File doesn't exist or can't be read, return default
      return this.getDefaultConfig();
    }
  }

  /**
   * Synchronous version of loadInstances for cases where we need immediate access
   * This will return defaults if the file doesn't exist, but won't auto-save them
   */
  loadInstancesSync(): ProviderInstancesConfig {
    try {
      const content = fs.readFileSync(this.configPath, 'utf-8');
      const parsed = JSON.parse(content) as unknown;
      const result = ProviderInstancesConfigSchema.safeParse(parsed);

      if (result.success) {
        return result.data;
      } else {
        console.warn('Invalid provider instances config, using default:', result.error);
        return this.getDefaultConfig();
      }
    } catch (_error) {
      // File doesn't exist or can't be read, return default
      return this.getDefaultConfig();
    }
  }

  async saveInstances(config: ProviderInstancesConfig): Promise<void> {
    // Serialize access to prevent concurrent writes from corrupting JSON
    if (this.savePromise) {
      await this.savePromise;
    }

    this.savePromise = this.performSave(config);
    try {
      await this.savePromise;
    } finally {
      this.savePromise = null;
    }
  }

  private async performSave(config: ProviderInstancesConfig): Promise<void> {
    await fs.promises.writeFile(this.configPath, JSON.stringify(config, null, 2));
  }

  loadCredential(instanceId: string): Credential | null {
    try {
      const credPath = path.join(this.credentialsDir, `${instanceId}.json`);
      const content = fs.readFileSync(credPath, 'utf-8');
      const parsed = JSON.parse(content) as unknown;
      const result = CredentialSchema.safeParse(parsed);

      if (result.success) {
        return result.data;
      } else {
        console.warn(`Invalid credential for instance ${instanceId}:`, result.error);
        return null;
      }
    } catch (_error) {
      // File doesn't exist or can't be read
      return null;
    }
  }

  async saveCredential(instanceId: string, credential: Credential): Promise<void> {
    await fs.promises.mkdir(this.credentialsDir, { recursive: true });
    const credPath = path.join(this.credentialsDir, `${instanceId}.json`);
    await fs.promises.writeFile(credPath, JSON.stringify(credential, null, 2), { mode: 0o600 });
  }

  async updateInstance(
    instanceId: string,
    updates: Partial<
      Omit<import('~/providers/catalog/types').ProviderInstance, 'catalogProviderId'>
    >
  ): Promise<void> {
    const config = await this.loadInstances();
    const existing = config.instances[instanceId];

    if (!existing) {
      throw new Error(`Instance not found: ${instanceId}`);
    }

    // Merge updates, but preserve catalogProviderId (it cannot be changed)
    config.instances[instanceId] = {
      ...existing,
      ...updates,
      catalogProviderId: existing.catalogProviderId, // Preserve original
    };

    await this.saveInstances(config);
  }

  async deleteInstance(instanceId: string): Promise<void> {
    // Remove from instances config
    const config = await this.loadInstances();
    delete config.instances[instanceId];
    await this.saveInstances(config);

    // Remove credential file
    try {
      const credPath = path.join(this.credentialsDir, `${instanceId}.json`);
      await fs.promises.unlink(credPath);
    } catch {
      // Ignore if credential file doesn't exist
    }
  }

  getDefaultConfig(): ProviderInstancesConfig {
    const instances: Record<string, ProviderInstance> = {};

    // Auto-create Anthropic provider instance if API key is available
    const hasAnthropicKey = getEnvVar('ANTHROPIC_KEY') || getEnvVar('ANTHROPIC_API_KEY');
    const hasOpenaiKey = getEnvVar('OPENAI_API_KEY') || getEnvVar('OPENAI_KEY');

    if (hasAnthropicKey) {
      instances['anthropic-default'] = {
        displayName: 'Anthropic (Default)',
        catalogProviderId: 'anthropic',
        // Use defaults from catalog - no need to override endpoint
      };
    }

    // Auto-create OpenAI provider instance if API key is available
    if (hasOpenaiKey) {
      instances['openai-default'] = {
        displayName: 'OpenAI (Default)',
        catalogProviderId: 'openai',
        // Use defaults from catalog - no need to override endpoint
      };
    }

    return {
      version: '1.0',
      instances,
    };
  }

  /**
   * Get the default provider instance ID and model for sessions when no configuration is specified
   */
  async getDefaultProviderInstance(): Promise<{
    providerInstanceId: string;
    modelId: string;
  } | null> {
    const config = await this.loadInstances();
    const instanceIds = Object.keys(config.instances);

    if (instanceIds.length === 0) {
      return null;
    }

    // Prefer anthropic-default if available, otherwise use first available
    const defaultInstanceId = instanceIds.includes('anthropic-default')
      ? 'anthropic-default'
      : instanceIds[0];

    const instance = config.instances[defaultInstanceId];

    // Determine default model based on catalog provider
    let defaultModelId: string;
    if (instance.catalogProviderId === 'anthropic') {
      defaultModelId = 'claude-3-5-haiku-20241022'; // Default small model
    } else if (instance.catalogProviderId === 'openai') {
      defaultModelId = 'gpt-4o'; // Default model
    } else {
      // For other providers, we'd need to look up the catalog
      defaultModelId = 'default-model';
    }

    return {
      providerInstanceId: defaultInstanceId,
      modelId: defaultModelId,
    };
  }

  /**
   * Get a provider instance by ID, with default model from catalog
   * Used by helper agents for programmatic provider access
   */
  async getInstance(instanceId: string): Promise<AIProvider | null> {
    const config = await this.loadInstances();
    const instance = config.instances[instanceId];

    if (!instance) {
      return null;
    }

    // Get the default model for this provider from catalog
    let modelId: string;
    if (instance.catalogProviderId === 'anthropic') {
      modelId = 'claude-3-5-haiku-20241022'; // Default small model
    } else if (instance.catalogProviderId === 'openai') {
      modelId = 'gpt-4o'; // Default model
    } else {
      modelId = 'default-model';
    }

    // Create provider using registry
    const registry = ProviderRegistry.getInstance();
    return await registry.createProviderFromInstanceAndModel(instanceId, modelId);
  }
}
