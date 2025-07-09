// ABOUTME: Tests for CLI provider validation using auto-discovered providers
// ABOUTME: Verifies provider validation works with registry instead of hardcoded lists

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateProvider } from '~/cli/args.js';
import { ProviderRegistry } from '~/providers/registry.js';
import { withConsoleCapture } from '~/__tests__/setup/console-capture.js';

describe('CLI Provider Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should accept valid providers from auto-discovery', async () => {
    const registry = await ProviderRegistry.createWithAutoDiscovery();

    // Should not throw for valid providers
    expect(() => validateProvider('anthropic', registry)).not.toThrow();
    expect(() => validateProvider('openai', registry)).not.toThrow();
    expect(() => validateProvider('lmstudio', registry)).not.toThrow();
    expect(() => validateProvider('ollama', registry)).not.toThrow();
  });

  it('should reject invalid providers with helpful error message', async () => {
    const registry = await ProviderRegistry.createWithAutoDiscovery();
    const { error } = withConsoleCapture();

    const mockProcessExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    expect(() => validateProvider('invalid', registry)).toThrow('process.exit called');

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("Error: Unknown provider 'invalid'")
    );
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Available providers: '));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('anthropic'));

    mockProcessExit.mockRestore();
  });

  it('should list all available providers in error message', async () => {
    const registry = await ProviderRegistry.createWithAutoDiscovery();
    const { error } = withConsoleCapture();

    const mockProcessExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    expect(() => validateProvider('nonexistent', registry)).toThrow('process.exit called');

    const errorCall = error.mock.calls[0][0] as string;
    expect(errorCall).toContain('anthropic');
    expect(errorCall).toContain('openai');
    expect(errorCall).toContain('lmstudio');
    expect(errorCall).toContain('ollama');

    mockProcessExit.mockRestore();
  });

  it('should validate against dynamic provider list', async () => {
    const registry = await ProviderRegistry.createWithAutoDiscovery();
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
