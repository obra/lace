// ABOUTME: Tests for the provider registry system
// ABOUTME: Verifies provider registration, retrieval, and management functionality

import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderRegistry } from '../registry.js';
import { AnthropicProvider } from '../anthropic-provider.js';
import { LMStudioProvider } from '../lmstudio-provider.js';

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
});
