// ABOUTME: Provider registry for managing available AI providers and their discovery
// ABOUTME: Handles provider registration and provides providers for agent execution

import { glob } from 'glob';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { AIProvider, ProviderResponse } from './base-provider.js';

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
    const timestamp = () => new Date().toISOString();
    console.log(`[Registry] ${timestamp()} Starting auto-discovery...`);
    const startTime = Date.now();
    const registry = new ProviderRegistry();

    // Get the directory path for the providers folder
    const currentFile = fileURLToPath(import.meta.url);
    const providersDir = dirname(currentFile);
    console.log(`[Registry] ${timestamp()} Provider dir: ${providersDir}`);

    // Find all provider files matching *-provider.ts pattern
    console.log(`[Registry] ${timestamp()} Globbing for JS files...`);
    const globStart = Date.now();
    const providerFiles = await glob('*-provider.js', {
      cwd: providersDir.replace('/src/', '/dist/'),
      absolute: true,
      ignore: 'base-provider.js',
    });
    console.log(
      `[Registry] ${timestamp()} JS glob took ${Date.now() - globStart}ms, found: ${providerFiles}`
    );

    // Also check for TypeScript files in development
    console.log(`[Registry] ${timestamp()} Globbing for TS files...`);
    const tsGlobStart = Date.now();
    const tsProviderFiles = await glob('*-provider.ts', {
      cwd: providersDir,
      absolute: true,
      ignore: '**/base-provider.ts',
    });
    console.log(
      `[Registry] ${timestamp()} TS glob took ${Date.now() - tsGlobStart}ms, found: ${tsProviderFiles}`
    );

    // Use TS files if available (development), otherwise use JS files (production)
    const filesToProcess = tsProviderFiles.length > 0 ? tsProviderFiles : providerFiles;

    for (const file of filesToProcess) {
      try {
        console.log(`[Registry] ${timestamp()} Importing ${file}...`);
        const importStart = Date.now();
        const module = await import(file);
        console.log(
          `[Registry] ${timestamp()} Import of ${file} took ${Date.now() - importStart}ms`
        );

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

    console.log(
      `[Registry] ${timestamp()} Auto-discovery completed in ${Date.now() - startTime}ms`
    );
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
