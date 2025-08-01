// ABOUTME: Manages user provider instances and credential storage
// ABOUTME: Handles provider-instances.json and credentials directory

import * as fs from 'fs';
import * as path from 'path';
import { getLaceDir } from '~/config/lace-dir';
import {
  ProviderInstancesConfig,
  ProviderInstancesConfigSchema,
  Credential,
  CredentialSchema,
} from '~/providers/catalog/types';

export class ProviderInstanceManager {
  private configPath: string;
  private credentialsDir: string;

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

  async saveInstances(config: ProviderInstancesConfig): Promise<void> {
    await fs.promises.writeFile(this.configPath, JSON.stringify(config, null, 2));
  }

  async loadCredential(instanceId: string): Promise<Credential | null> {
    try {
      const credPath = path.join(this.credentialsDir, `${instanceId}.json`);
      const content = await fs.promises.readFile(credPath, 'utf-8');
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

  private getDefaultConfig(): ProviderInstancesConfig {
    return {
      version: '1.0',
      instances: {},
    };
  }
}
