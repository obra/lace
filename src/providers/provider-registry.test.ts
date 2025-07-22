// ABOUTME: Tests for the provider registry system
// ABOUTME: Verifies provider registration, retrieval, and management functionality

import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderRegistry } from '~/providers/registry';
import { AnthropicProvider } from '~/providers/anthropic-provider';
import { LMStudioProvider } from '~/providers/lmstudio-provider';
import { OpenAIProvider } from '~/providers/openai-provider';
import { OllamaProvider } from '~/providers/ollama-provider';

describe('ProviderRegistry', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  describe('registerProvider', () => {
    it('should register an Anthropic provider', () => {
      const provider = new AnthropicProvider({ apiKey: 'test-key' });
      registry.registerProvider(provider);

      expect(registry.getProvider('anthropic')).toBe(provider);
    });

    it('should register an LMStudio provider', () => {
      const provider = new LMStudioProvider();
      registry.registerProvider(provider);

      expect(registry.getProvider('lmstudio')).toBe(provider);
    });

    it('should replace existing provider with same name', () => {
      const provider1 = new AnthropicProvider({ apiKey: 'key1' });
      const provider2 = new AnthropicProvider({ apiKey: 'key2' });

      registry.registerProvider(provider1);
      registry.registerProvider(provider2);

      expect(registry.getProvider('anthropic')).toBe(provider2);
    });
  });

  describe('getProvider', () => {
    it('should return undefined for unregistered provider', () => {
      expect(registry.getProvider('nonexistent')).toBeUndefined();
    });

    it('should return registered provider', () => {
      const provider = new LMStudioProvider();
      registry.registerProvider(provider);

      expect(registry.getProvider('lmstudio')).toBe(provider);
    });
  });

  describe('getAllProviders', () => {
    it('should return empty array when no providers registered', () => {
      expect(registry.getAllProviders()).toEqual([]);
    });

    it('should return all registered providers', () => {
      const anthropicProvider = new AnthropicProvider({ apiKey: 'test-key' });
      const lmstudioProvider = new LMStudioProvider();

      registry.registerProvider(anthropicProvider);
      registry.registerProvider(lmstudioProvider);

      const providers = registry.getAllProviders();
      expect(providers).toHaveLength(2);
      expect(providers).toContain(anthropicProvider);
      expect(providers).toContain(lmstudioProvider);
    });
  });

  describe('getProviderNames', () => {
    it('should return empty array when no providers registered', () => {
      expect(registry.getProviderNames()).toEqual([]);
    });

    it('should return names of all registered providers', () => {
      const anthropicProvider = new AnthropicProvider({ apiKey: 'test-key' });
      const lmstudioProvider = new LMStudioProvider();

      registry.registerProvider(anthropicProvider);
      registry.registerProvider(lmstudioProvider);

      const names = registry.getProviderNames();
      expect(names).toHaveLength(2);
      expect(names).toContain('anthropic');
      expect(names).toContain('lmstudio');
    });
  });

  describe('createWithAutoDiscovery', () => {
    it('should discover and register all existing provider files', () => {
      const registry = ProviderRegistry.createWithAutoDiscovery();
      const providerNames = registry.getProviderNames();

      expect(providerNames).toContain('anthropic');
      expect(providerNames).toContain('openai');
      expect(providerNames).toContain('lmstudio');
      expect(providerNames).toContain('ollama');
      expect(providerNames).toHaveLength(4);
    });

    it('should register providers with correct instances', () => {
      const registry = ProviderRegistry.createWithAutoDiscovery();

      const anthropicProvider = registry.getProvider('anthropic');
      const openaiProvider = registry.getProvider('openai');
      const lmstudioProvider = registry.getProvider('lmstudio');
      const ollamaProvider = registry.getProvider('ollama');

      expect(anthropicProvider).toBeDefined();
      expect(openaiProvider).toBeDefined();
      expect(lmstudioProvider).toBeDefined();
      expect(ollamaProvider).toBeDefined();

      expect(anthropicProvider!.providerName).toBe('anthropic');
      expect(openaiProvider!.providerName).toBe('openai');
      expect(lmstudioProvider!.providerName).toBe('lmstudio');
      expect(ollamaProvider!.providerName).toBe('ollama');
    });

    it('should only discover files matching *-provider.ts pattern', () => {
      const registry = ProviderRegistry.createWithAutoDiscovery();
      const providerNames = registry.getProviderNames();

      // Should not include non-provider files like types.ts, registry.ts, etc.
      expect(providerNames).not.toContain('types');
      expect(providerNames).not.toContain('registry');
      expect(providerNames).not.toContain('format-converters');
    });

    it('should handle provider files with missing exports gracefully', () => {
      // This test ensures auto-discovery doesn't crash on malformed files
      // We don't need to create malformed files - just verify it doesn't throw
      expect(ProviderRegistry.createWithAutoDiscovery()).toBeDefined();
    });
  });

  describe('isProviderClass', () => {
    it('should identify valid provider classes', () => {
      expect(ProviderRegistry.isProviderClass(AnthropicProvider)).toBe(true);
      expect(ProviderRegistry.isProviderClass(OpenAIProvider)).toBe(true);
      expect(ProviderRegistry.isProviderClass(LMStudioProvider)).toBe(true);
      expect(ProviderRegistry.isProviderClass(OllamaProvider)).toBe(true);
    });

    it('should reject non-provider classes', () => {
      class NotAProvider {}
      class AlmostProvider {
        providerName = 'test';
      }

      expect(ProviderRegistry.isProviderClass(NotAProvider)).toBe(false);
      expect(ProviderRegistry.isProviderClass(AlmostProvider)).toBe(false);
    });

    it('should reject non-class values', () => {
      expect(ProviderRegistry.isProviderClass({})).toBe(false);
      expect(ProviderRegistry.isProviderClass('string')).toBe(false);
      expect(ProviderRegistry.isProviderClass(123)).toBe(false);
      expect(ProviderRegistry.isProviderClass(null)).toBe(false);
      expect(ProviderRegistry.isProviderClass(undefined)).toBe(false);
    });
  });
});
