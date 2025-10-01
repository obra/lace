import { describe, it, expect, beforeEach } from 'vitest';
import { ClaudeSDKProvider } from './claude-sdk-provider';

describe('ClaudeSDKProvider', () => {
  let provider: ClaudeSDKProvider;

  beforeEach(() => {
    provider = new ClaudeSDKProvider({ sessionToken: 'test-token' });
  });

  it('should have correct provider name', () => {
    expect(provider.providerName).toBe('claude-agents-sdk');
  });

  it('should support streaming', () => {
    expect(provider.supportsStreaming).toBe(true);
  });

  it('should return provider info', () => {
    const info = provider.getProviderInfo();
    expect(info.name).toBe('claude-agents-sdk');
    expect(info.displayName).toContain('SDK');
    expect(info.requiresApiKey).toBe(true);
  });

  it('should return model list', () => {
    const models = provider.getAvailableModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models.some((m) => m.id.includes('sonnet'))).toBe(true);
  });

  it('should check configuration', () => {
    expect(provider.isConfigured()).toBe(true);

    const unconfigured = new ClaudeSDKProvider({ sessionToken: null });
    expect(unconfigured.isConfigured()).toBe(false);
  });

  it('should throw on createResponse (not implemented)', async () => {
    await expect(provider.createResponse([], [], 'model', undefined)).rejects.toThrow(
      'Not implemented'
    );
  });
});
