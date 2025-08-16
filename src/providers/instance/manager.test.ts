// ABOUTME: Tests for provider instance manager
// ABOUTME: Validates instance configuration and credential storage

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ProviderInstanceManager } from '~/providers/instance/manager';
import type { ProviderInstancesConfig, Credential } from '~/providers/catalog/types';

describe('ProviderInstanceManager', () => {
  let tempDir: string;
  let originalLaceDir: string | undefined;
  let manager: ProviderInstanceManager;

  beforeEach(() => {
    // Suppress console output during tests that intentionally trigger validation errors
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Create temp directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-test-'));
    originalLaceDir = process.env.LACE_DIR;
    process.env.LACE_DIR = tempDir;
    manager = new ProviderInstanceManager();
  });

  afterEach(() => {
    // Restore console mocks
    vi.restoreAllMocks();

    // Cleanup
    if (originalLaceDir) {
      process.env.LACE_DIR = originalLaceDir;
    } else {
      delete process.env.LACE_DIR;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('loadInstances', () => {
    it('returns empty config when file does not exist', async () => {
      const config = await manager.loadInstances();
      expect(config.version).toBe('1.0');
      expect(config.instances).toEqual({});
    });

    it('loads existing configuration file', async () => {
      const testConfig: ProviderInstancesConfig = {
        version: '1.0',
        instances: {
          'openai-prod': {
            displayName: 'OpenAI Production',
            catalogProviderId: 'openai',
            timeout: 30000,
          },
          'anthropic-dev': {
            displayName: 'Anthropic Development',
            catalogProviderId: 'anthropic',
            endpoint: 'https://api.anthropic.com/v1',
          },
        },
      };

      // Write test config
      const configPath = path.join(tempDir, 'provider-instances.json');
      fs.writeFileSync(configPath, JSON.stringify(testConfig, null, 2));

      const loaded = await manager.loadInstances();
      expect(loaded).toEqual(testConfig);
    });

    it('handles corrupted JSON gracefully', async () => {
      const configPath = path.join(tempDir, 'provider-instances.json');
      fs.writeFileSync(configPath, '{ invalid json');

      const config = await manager.loadInstances();
      expect(config.version).toBe('1.0');
      expect(config.instances).toEqual({});
    });

    it('validates config against schema', async () => {
      const invalidConfig = {
        version: '2.0', // Wrong version
        instances: {},
      };

      const configPath = path.join(tempDir, 'provider-instances.json');
      fs.writeFileSync(configPath, JSON.stringify(invalidConfig, null, 2));

      const config = await manager.loadInstances();
      expect(config.version).toBe('1.0'); // Should fall back to default
      expect(config.instances).toEqual({});
    });
  });

  describe('saveInstances', () => {
    it('saves configuration to file', async () => {
      const testConfig: ProviderInstancesConfig = {
        version: '1.0',
        instances: {
          'openai-test': {
            displayName: 'OpenAI Test',
            catalogProviderId: 'openai',
          },
        },
      };

      await manager.saveInstances(testConfig);

      const configPath = path.join(tempDir, 'provider-instances.json');
      expect(fs.existsSync(configPath)).toBe(true);

      const savedContent = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as unknown;
      expect(savedContent).toEqual(testConfig);
    });

    it('overwrites existing configuration', async () => {
      const initialConfig: ProviderInstancesConfig = {
        version: '1.0',
        instances: { old: { displayName: 'Old', catalogProviderId: 'openai' } },
      };

      const newConfig: ProviderInstancesConfig = {
        version: '1.0',
        instances: { new: { displayName: 'New', catalogProviderId: 'anthropic' } },
      };

      await manager.saveInstances(initialConfig);
      await manager.saveInstances(newConfig);

      const loaded = await manager.loadInstances();
      expect(loaded).toEqual(newConfig);
    });
  });

  describe('loadCredential', () => {
    it('returns null when credential file does not exist', async () => {
      const credential = await manager.loadCredential('non-existent');
      expect(credential).toBeNull();
    });

    it('loads existing credential file', async () => {
      const testCredential: Credential = {
        apiKey: 'sk-test123',
        additionalAuth: { orgId: 'org-123' },
      };

      // Create credentials directory and file
      const credentialsDir = path.join(tempDir, 'credentials');
      fs.mkdirSync(credentialsDir, { recursive: true });
      fs.writeFileSync(
        path.join(credentialsDir, 'test-instance.json'),
        JSON.stringify(testCredential, null, 2)
      );

      const loaded = await manager.loadCredential('test-instance');
      expect(loaded).toEqual(testCredential);
    });

    it('handles corrupted credential JSON gracefully', async () => {
      const credentialsDir = path.join(tempDir, 'credentials');
      fs.mkdirSync(credentialsDir, { recursive: true });
      fs.writeFileSync(path.join(credentialsDir, 'corrupted.json'), '{ invalid');

      const credential = await manager.loadCredential('corrupted');
      expect(credential).toBeNull();
    });

    it('validates credential against schema', async () => {
      const invalidCredential = {
        apiKey: '', // Empty API key should be invalid
      };

      const credentialsDir = path.join(tempDir, 'credentials');
      fs.mkdirSync(credentialsDir, { recursive: true });
      fs.writeFileSync(
        path.join(credentialsDir, 'invalid.json'),
        JSON.stringify(invalidCredential, null, 2)
      );

      const credential = await manager.loadCredential('invalid');
      expect(credential).toBeNull();
    });
  });

  describe('saveCredential', () => {
    it('saves credential to file with proper permissions', async () => {
      const testCredential: Credential = {
        apiKey: 'sk-secret123',
      };

      await manager.saveCredential('test-instance', testCredential);

      const credentialPath = path.join(tempDir, 'credentials', 'test-instance.json');
      expect(fs.existsSync(credentialPath)).toBe(true);

      // Check file content
      const savedContent = JSON.parse(fs.readFileSync(credentialPath, 'utf-8')) as unknown;
      expect(savedContent).toEqual(testCredential);

      // Check file permissions (0o600)
      const stats = fs.statSync(credentialPath);
      const mode = stats.mode & parseInt('777', 8);
      expect(mode).toBe(0o600);
    });

    it('creates credentials directory if it does not exist', async () => {
      const testCredential: Credential = {
        apiKey: 'sk-test123',
      };

      const credentialsDir = path.join(tempDir, 'credentials');
      expect(fs.existsSync(credentialsDir)).toBe(false);

      await manager.saveCredential('test-instance', testCredential);

      expect(fs.existsSync(credentialsDir)).toBe(true);
      const credentialPath = path.join(credentialsDir, 'test-instance.json');
      expect(fs.existsSync(credentialPath)).toBe(true);
    });

    it('overwrites existing credential', async () => {
      const oldCredential: Credential = { apiKey: 'old-key' };
      const newCredential: Credential = { apiKey: 'new-key' };

      await manager.saveCredential('test-instance', oldCredential);
      await manager.saveCredential('test-instance', newCredential);

      const loaded = await manager.loadCredential('test-instance');
      expect(loaded).toEqual(newCredential);
    });
  });

  describe('deleteInstance', () => {
    beforeEach(async () => {
      // Set up test instances and credentials
      const config: ProviderInstancesConfig = {
        version: '1.0',
        instances: {
          'test-1': { displayName: 'Test 1', catalogProviderId: 'openai' },
          'test-2': { displayName: 'Test 2', catalogProviderId: 'anthropic' },
        },
      };
      await manager.saveInstances(config);
      await manager.saveCredential('test-1', { apiKey: 'key-1' });
      await manager.saveCredential('test-2', { apiKey: 'key-2' });
    });

    it('removes instance from config and deletes credential file', async () => {
      await manager.deleteInstance('test-1');

      // Check config updated
      const config = await manager.loadInstances();
      expect(config.instances).toEqual({
        'test-2': { displayName: 'Test 2', catalogProviderId: 'anthropic' },
      });

      // Check credential file deleted
      const credentialPath = path.join(tempDir, 'credentials', 'test-1.json');
      expect(fs.existsSync(credentialPath)).toBe(false);

      // Other instance should remain
      const remainingCredential = await manager.loadCredential('test-2');
      expect(remainingCredential).toEqual({ apiKey: 'key-2' });
    });

    it('handles deletion of non-existent instance gracefully', async () => {
      await expect(manager.deleteInstance('non-existent')).resolves.not.toThrow();

      // Original instances should remain unchanged
      const config = await manager.loadInstances();
      expect(Object.keys(config.instances)).toHaveLength(2);
    });

    it('handles missing credential file gracefully', async () => {
      // Delete credential file manually first
      const credentialPath = path.join(tempDir, 'credentials', 'test-1.json');
      fs.unlinkSync(credentialPath);

      await expect(manager.deleteInstance('test-1')).resolves.not.toThrow();

      // Instance should still be removed from config
      const config = await manager.loadInstances();
      expect(config.instances['test-1']).toBeUndefined();
    });
  });
});
