// ABOUTME: Provider registry for managing available AI providers and their discovery
// ABOUTME: Handles provider registration and provides providers for agent execution

import { glob } from 'glob';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { AIProvider, ProviderResponse } from './types.js';

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
            const ProviderClass = exportedValue as new (...args: unknown[]) => AIProvider;

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
                  apiKey: 'discovery-mode-placeholder',
                  baseURL: 'https://api.placeholder.com',
                };
                provider = new ProviderClass(defaultConfig);
              } catch {
                // Create a minimal placeholder provider for discovery purposes
                class PlaceholderProvider extends AIProvider {
                  get providerName() {
                    return ProviderClass.name.toLowerCase().replace('provider', '');
                  }
                  get defaultModel() {
                    return 'discovery-model';
                  }
                  get supportsStreaming() {
                    return true;
                  }
                  async createResponse(): Promise<ProviderResponse> {
                    throw new Error('Provider not properly configured');
                  }
                }

                const placeholderProvider = new PlaceholderProvider({});
                registry.registerProvider(placeholderProvider);
                continue;
              }
            }

            registry.registerProvider(provider);
          }
        }
      } catch {
        // Skip files that can't be imported or have errors
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
    let proto = value.prototype;
    while (proto) {
      if (proto.constructor.name === 'AIProvider') return true;
      proto = Object.getPrototypeOf(proto);
    }
    return false;
  }
}
