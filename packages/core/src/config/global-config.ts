// ABOUTME: Global configuration manager for system-wide settings
// ABOUTME: Manages ~/.lace/config.json including default model configurations

import * as fs from 'fs';
import { getLaceFilePath } from '~/config/lace-dir';

interface GlobalConfig {
  defaultModels: {
    fast?: string;
    smart?: string;
  };
  // Room for future global settings
}

export class GlobalConfigManager {
  private static cachedConfig: GlobalConfig | null = null;

  /**
   * Load the global configuration from ~/.lace/config.json
   * Caches the result for subsequent calls
   */
  private static loadConfig(): GlobalConfig {
    if (this.cachedConfig) {
      return this.cachedConfig;
    }

    const configPath = getLaceFilePath('config.json');

    if (!fs.existsSync(configPath)) {
      throw new Error(
        `Global config not found at ${configPath}. ` +
          `Please create this file with a 'defaultModels' section containing 'fast' and 'smart' model configurations.`
      );
    }

    try {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      this.cachedConfig = JSON.parse(configContent) as GlobalConfig;
      return this.cachedConfig;
    } catch (error) {
      throw new Error(
        `Failed to parse global config at ${configPath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get the default model configuration for a given tier
   * @param tier - Either 'fast' or 'smart'
   * @returns The provider:model string for the requested tier
   * @throws Error if config is missing or tier is not configured
   */
  static getDefaultModel(tier: 'fast' | 'smart'): string {
    const config = this.loadConfig();

    if (!config.defaultModels) {
      throw new Error(
        `Global config is missing 'defaultModels' section. ` +
          `Please add a 'defaultModels' object with 'fast' and 'smart' model configurations.`
      );
    }

    const model = config.defaultModels[tier];

    if (!model) {
      throw new Error(
        `No default model configured for '${tier}'. ` +
          `Please add a '${tier}' entry to the 'defaultModels' section of your global config.`
      );
    }

    return model;
  }

  /**
   * Clear the cached config (mainly for testing)
   */
  static clearCache(): void {
    this.cachedConfig = null;
  }
}
