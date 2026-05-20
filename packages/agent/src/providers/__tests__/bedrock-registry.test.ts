// ABOUTME: Tests that ProviderRegistry can construct a BedrockProvider
// ABOUTME: Covers createProvider direct dispatch and metadata lookup paths

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ProviderRegistry } from '../registry';
import { BedrockProvider } from '../bedrock-provider';

describe('ProviderRegistry → BedrockProvider', () => {
  let tempDir: string;
  let originalLaceDir: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-bedrock-'));
    originalLaceDir = process.env.LACE_DIR;
    process.env.LACE_DIR = tempDir;
    ProviderRegistry.clearInstance();
  });

  afterEach(() => {
    if (originalLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = originalLaceDir;
    fs.rmSync(tempDir, { recursive: true, force: true });
    ProviderRegistry.clearInstance();
  });

  it('createProvider("bedrock", config) returns a BedrockProvider', () => {
    const registry = ProviderRegistry.getInstance();

    const provider = registry.createProvider('bedrock', {
      awsRegion: 'us-west-1',
      awsAccessKeyId: 'AKIATEST',
      awsSecretAccessKey: 'secret',
    });

    expect(provider).toBeInstanceOf(BedrockProvider);
    expect(provider.providerName).toBe('bedrock');
    expect(provider.isConfigured()).toBe(true);
  });

  it('createProvider("bedrock") works with only a region (default credential chain)', () => {
    const registry = ProviderRegistry.getInstance();

    const provider = registry.createProvider('bedrock', { awsRegion: 'us-west-1' });

    expect(provider).toBeInstanceOf(BedrockProvider);
    expect(provider.isConfigured()).toBe(true);
  });

  it('lists bedrock among the available providers', () => {
    const registry = ProviderRegistry.getInstance();
    const available = registry.getAvailableProviders();
    const names = available.map((p) => p.info.name);
    expect(names).toContain('bedrock');
  });
});
