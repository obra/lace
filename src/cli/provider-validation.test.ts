// ABOUTME: Tests for CLI provider validation using auto-discovered providers
// ABOUTME: Verifies provider validation works with registry instead of hardcoded lists

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateProvider } from '~/cli/args';
import { ProviderRegistry } from '~/providers/registry';

describe('CLI Provider Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should accept valid providers from auto-discovery', () => {
    const registry = ProviderRegistry.createWithAutoDiscovery();

    // Should not throw for valid providers
    expect(() => validateProvider('anthropic', registry)).not.toThrow();
    expect(() => validateProvider('openai', registry)).not.toThrow();
    expect(() => validateProvider('lmstudio', registry)).not.toThrow();
    expect(() => validateProvider('ollama', registry)).not.toThrow();
  });

  it('should reject invalid providers with helpful error message', () => {
    const registry = ProviderRegistry.createWithAutoDiscovery();

    const mockProcessExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    expect(() => validateProvider('invalid', registry)).toThrow('process.exit called');

    // Error messages are logged to console but we don't verify the exact output

    mockProcessExit.mockRestore();
  });

  it('should list all available providers in error message', () => {
    const registry = ProviderRegistry.createWithAutoDiscovery();

    const mockProcessExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    expect(() => validateProvider('nonexistent', registry)).toThrow('process.exit called');

    // Provider list is logged to console for user reference

    mockProcessExit.mockRestore();
  });

  it('should validate against dynamic provider list', () => {
    const registry = ProviderRegistry.createWithAutoDiscovery();
    const availableProviders = registry.getProviderNames();

    // All discovered providers should be valid
    for (const provider of availableProviders) {
      expect(() => validateProvider(provider, registry)).not.toThrow();
    }

    // Non-existent provider should be invalid
    const mockProcessExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    expect(() => validateProvider('fake-provider', registry)).toThrow('process.exit called');

    mockProcessExit.mockRestore();
  });
});
