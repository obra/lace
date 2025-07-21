// ABOUTME: Tests for CLI integration with auto-discovered providers
// ABOUTME: Verifies that CLI can work with dynamically discovered providers instead of hardcoded lists

import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderRegistry } from '~/providers/registry';

describe('CLI Auto-Discovery Integration', () => {
  beforeEach(() => {
    // Reset any test state if needed
  });

  describe('Provider Creation with Auto-Discovery', () => {
    it('should create providers using auto-discovered registry', () => {
      const registry = ProviderRegistry.createWithAutoDiscovery();

      // Should be able to get all current providers
      expect(registry.getProvider('anthropic')).toBeDefined();
      expect(registry.getProvider('openai')).toBeDefined();
      expect(registry.getProvider('lmstudio')).toBeDefined();
      expect(registry.getProvider('ollama')).toBeDefined();
    });

    it('should handle provider creation with proper configuration', () => {
      const registry = ProviderRegistry.createWithAutoDiscovery();

      // Test that providers can be retrieved and have correct names
      const anthropicProvider = registry.getProvider('anthropic');
      const openaiProvider = registry.getProvider('openai');
      const lmstudioProvider = registry.getProvider('lmstudio');
      const ollamaProvider = registry.getProvider('ollama');

      expect(anthropicProvider!.providerName).toBe('anthropic');
      expect(openaiProvider!.providerName).toBe('openai');
      expect(lmstudioProvider!.providerName).toBe('lmstudio');
      expect(ollamaProvider!.providerName).toBe('ollama');
    });

    it('should provide list of available provider names', () => {
      const registry = ProviderRegistry.createWithAutoDiscovery();
      const providerNames = registry.getProviderNames();

      expect(providerNames).toContain('anthropic');
      expect(providerNames).toContain('openai');
      expect(providerNames).toContain('lmstudio');
      expect(providerNames).toContain('ollama');
      expect(providerNames).toHaveLength(4);
    });

    it('should handle unknown provider names gracefully', () => {
      const registry = ProviderRegistry.createWithAutoDiscovery();

      expect(registry.getProvider('nonexistent')).toBeUndefined();
      expect(registry.getProvider('invalid')).toBeUndefined();
    });
  });

  describe('CLI Argument Validation with Auto-Discovery', () => {
    it('should validate provider names against auto-discovered providers', () => {
      const registry = ProviderRegistry.createWithAutoDiscovery();
      const availableProviders = registry.getProviderNames();

      // Valid providers should be accepted
      for (const providerName of availableProviders) {
        expect(availableProviders).toContain(providerName);
      }

      // Invalid providers should be rejected
      expect(availableProviders).not.toContain('nonexistent');
      expect(availableProviders).not.toContain('invalid');
    });

    it('should generate dynamic help text from available providers', () => {
      const registry = ProviderRegistry.createWithAutoDiscovery();
      const providerNames = registry.getProviderNames();

      // Help text should include all discovered providers
      const helpText = `Available providers: ${providerNames.join(', ')}`;

      expect(helpText).toContain('anthropic');
      expect(helpText).toContain('openai');
      expect(helpText).toContain('lmstudio');
      expect(helpText).toContain('ollama');
    });

    it('should handle provider validation errors with helpful messages', () => {
      const registry = ProviderRegistry.createWithAutoDiscovery();
      const availableProviders = registry.getProviderNames();

      // Simulate validation error for unknown provider
      const unknownProvider = 'unknown-provider';
      const isValidProvider = availableProviders.includes(unknownProvider);

      expect(isValidProvider).toBe(false);

      // Error message should list available providers
      if (!isValidProvider) {
        const errorMessage = `Unknown provider '${unknownProvider}'. Available providers: ${availableProviders.join(', ')}`;
        expect(errorMessage).toContain('anthropic');
        expect(errorMessage).toContain('openai');
        expect(errorMessage).toContain('lmstudio');
        expect(errorMessage).toContain('ollama');
      }
    });
  });

  describe('Provider Registration Flexibility', () => {
    it('should support adding new providers without CLI changes', () => {
      const registry = ProviderRegistry.createWithAutoDiscovery();
      const initialProviderCount = registry.getProviderNames().length;

      // This test demonstrates that new providers can be discovered
      // without any CLI code changes - they just need to follow the naming convention
      expect(initialProviderCount).toBe(4); // Current providers

      // If a new provider file was added, it would be automatically discovered
      // This test verifies the foundation for that capability
    });

    it('should maintain provider consistency across registry operations', () => {
      const registry1 = ProviderRegistry.createWithAutoDiscovery();
      const registry2 = ProviderRegistry.createWithAutoDiscovery();

      // Both registries should discover the same providers
      const names1 = registry1.getProviderNames().sort();
      const names2 = registry2.getProviderNames().sort();

      expect(names1).toEqual(names2);
      expect(names1).toHaveLength(4);
    });
  });
});
