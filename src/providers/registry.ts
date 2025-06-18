// ABOUTME: Provider registry for managing available AI providers and their discovery
// ABOUTME: Handles provider registration and provides providers for agent execution

import { glob } from 'glob';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
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

  static async createWithAutoDiscovery(): Promise<ProviderRegistry> {
    const registry = new ProviderRegistry();

    // Get the directory path for the providers folder
    const currentFile = fileURLToPath(import.meta.url);
    const providersDir = dirname(currentFile);

    // Find all provider files matching *-provider.ts pattern
    const providerFiles = await glob('*-provider.js', {
      cwd: providersDir.replace('/src/', '/dist/'),
      absolute: true,
    });

    // Also check for TypeScript files in development
    const tsProviderFiles = await glob('*-provider.ts', {
      cwd: providersDir,
      absolute: true,
    });

    // Use TS files if available (development), otherwise use JS files (production)
    const filesToProcess = tsProviderFiles.length > 0 ? tsProviderFiles : providerFiles;

    for (const file of filesToProcess) {
      try {
        const module = await import(file);

        // Check all exports in the module
        for (const exportedValue of Object.values(module)) {
          if (ProviderRegistry.isProviderClass(exportedValue)) {
            const ProviderClass = exportedValue as new (...args: any[]) => AIProvider;

            // Create instance with default configuration
            let provider: AIProvider;
            try {
              // Try with empty config first
              provider = new ProviderClass({});
            } catch {
              // Some providers might need specific config, create with minimal config
              try {
                // For providers that require API keys, use placeholder values for discovery
                const defaultConfig = {
                  apiKey: 'discovery-mode', // Placeholder API key for auto-discovery
                };
                provider = new ProviderClass(defaultConfig);
              } catch {
                // Skip providers that can't be instantiated without proper config
                continue;
              }
            }

            registry.registerProvider(provider);
          }
        }
      } catch (error) {
        // Skip files that can't be imported or have errors
        console.warn(`Failed to import provider file ${file}:`, error);
      }
    }

    return registry;
  }

  static isProviderClass(value: any): boolean {
    // Check if it's a constructor function/class
    if (typeof value !== 'function') {
      return false;
    }

    // Check if it has a prototype
    if (!value.prototype) {
      return false;
    }

    // Try to create an instance to check if it implements AIProvider interface
    try {
      let instance: any;
      try {
        // Try with empty config first
        instance = new value({});
      } catch {
        // Try with minimal config for providers that require API keys
        try {
          const defaultConfig = {
            apiKey: 'discovery-mode',
          };
          instance = new value(defaultConfig);
        } catch {
          return false;
        }
      }

      // Check if instance has required AIProvider properties
      return (
        typeof instance.providerName === 'string' &&
        typeof instance.defaultModel === 'string' &&
        typeof instance.supportsStreaming === 'boolean' &&
        typeof instance.createResponse === 'function'
      );
    } catch {
      return false;
    }
  }
}
