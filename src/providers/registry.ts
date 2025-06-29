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
    const registry = new ProviderRegistry();

    // Get the directory path for the providers folder
    const currentFile = fileURLToPath(import.meta.url);
    const providersDir = dirname(currentFile);

    // Use a single, more efficient glob operation
    const providerFiles = await glob('*-provider.{js,ts}', {
      cwd: providersDir,
      absolute: true,
      ignore: ['**/base-provider.*', '**/dist/**'],
    });

    // Process files with timeout to prevent hanging
    const timeout = 5000; // 5 seconds timeout per provider
    const promises = providerFiles.map(file => 
      Promise.race([
        ProviderRegistry.processProviderFile(file, registry),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`Timeout processing ${file}`)), timeout)
        )
      ]).catch(() => {
        // Silently skip files that can't be processed or timeout
      })
    );

    await Promise.all(promises);

    return registry;
  }

  private static async processProviderFile(file: string, registry: ProviderRegistry): Promise<void> {
    try {
      const module = await import(file);

      // Check all exports in the module
      for (const exportedValue of Object.values(module)) {
        if (ProviderRegistry.isProviderClass(exportedValue)) {
          const ProviderClass = exportedValue as new (...args: unknown[]) => AIProvider;

          // Create instance with default configuration - simplified approach
          let provider: AIProvider;
          try {
            // Try with empty config first
            provider = new ProviderClass({});
          } catch {
            // Try with placeholder config
            try {
              const placeholderConfig = {
                apiKey: 'discovery-placeholder',
                baseURL: 'https://placeholder.api',
              };
              provider = new ProviderClass(placeholderConfig);
            } catch {
              // Create minimal placeholder without instantiating actual provider
              const providerName = ProviderClass.name.toLowerCase().replace('provider', '');
              const placeholder = new (class extends AIProvider {
                get providerName() { return providerName; }
                get defaultModel() { return 'default'; }
                get supportsStreaming() { return true; }
                async createResponse(): Promise<ProviderResponse> {
                  throw new Error('Provider not configured');
                }
              })({});
              
              registry.registerProvider(placeholder);
              continue;
            }
          }

          registry.registerProvider(provider);
        }
      }
    } catch {
      // Skip files that can't be imported
    }
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
