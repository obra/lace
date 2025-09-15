// ABOUTME: Test to reproduce provider-instances.json corruption with concurrent writes
// ABOUTME: Simulates the race condition that causes "elConfig" text to be appended

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ProviderInstanceManager } from './manager';
import type { ProviderInstancesConfig } from '../catalog/types';

describe('ProviderInstanceManager - Corruption Reproduction', () => {
  let tempDir: string;
  let manager: ProviderInstanceManager;

  beforeEach(() => {
    // Create a temporary directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-corruption-test-'));
    process.env.LACE_DIR = tempDir;
    manager = new ProviderInstanceManager();
  });

  afterEach(() => {
    // Clean up
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should handle concurrent writes without corruption', async () => {
    // Create initial config with modelConfig
    const initialConfig: ProviderInstancesConfig = {
      version: '1.0',
      instances: {
        'test-instance-1': {
          displayName: 'Test Instance 1',
          catalogProviderId: 'test-provider',
          modelConfig: {
            enableNewModels: true,
            disabledModels: ['model-1', 'model-2'],
            disabledProviders: [],
            filters: {},
          },
        },
        'test-instance-2': {
          displayName: 'Test Instance 2',
          catalogProviderId: 'test-provider',
          modelConfig: {
            enableNewModels: false,
            disabledModels: [],
            disabledProviders: ['provider-1'],
            filters: {},
          },
        },
      },
    };

    // Save initial config
    await manager.saveInstances(initialConfig);

    // Simulate concurrent updates like what happens when multiple ProviderInstanceCard components save
    const promises: Promise<void>[] = [];

    // Simulate 10 concurrent saves with slightly different data
    for (let i = 0; i < 10; i++) {
      const config: ProviderInstancesConfig = {
        version: '1.0',
        instances: {
          ...initialConfig.instances,
          [`test-instance-${i}`]: {
            displayName: `Test Instance ${i}`,
            catalogProviderId: 'test-provider',
            modelConfig: {
              enableNewModels: i % 2 === 0,
              disabledModels: [`model-${i}`],
              disabledProviders: [],
              filters: {},
            },
          },
        },
      };

      // Don't await - let them run concurrently
      promises.push(manager.saveInstances(config));
    }

    // Wait for all saves to complete
    await Promise.all(promises);

    // Read the final file
    const finalPath = path.join(tempDir, 'provider-instances.json');
    const finalContent = fs.readFileSync(finalPath, 'utf-8');

    // Check for corruption patterns
    expect(finalContent).not.toContain('elConfig');
    expect(finalContent).not.toContain('}}}}'); // Multiple closing braces
    expect(finalContent).not.toMatch(/\}\s*\{/); // JSON objects concatenated

    // Verify it's valid JSON
    let parsed: any;
    expect(() => {
      parsed = JSON.parse(finalContent);
    }).not.toThrow();

    // Verify structure is intact
    expect(parsed).toHaveProperty('version', '1.0');
    expect(parsed).toHaveProperty('instances');
    expect(typeof parsed.instances).toBe('object');
  });

  it('should handle rapid sequential updates without corruption', async () => {
    const initialConfig: ProviderInstancesConfig = {
      version: '1.0',
      instances: {
        'test-instance': {
          displayName: 'Test Instance',
          catalogProviderId: 'test-provider',
          modelConfig: {
            enableNewModels: true,
            disabledModels: [],
            disabledProviders: [],
            filters: {},
          },
        },
      },
    };

    await manager.saveInstances(initialConfig);

    // Simulate rapid updates like toggling models quickly
    for (let i = 0; i < 20; i++) {
      const config: ProviderInstancesConfig = {
        version: '1.0',
        instances: {
          'test-instance': {
            displayName: 'Test Instance',
            catalogProviderId: 'test-provider',
            modelConfig: {
              enableNewModels: true,
              disabledModels: Array.from({ length: i }, (_, j) => `model-${j}`),
              disabledProviders: [],
              filters: {},
            },
          },
        },
      };

      // Await each one to simulate rapid sequential updates
      await manager.saveInstances(config);
    }

    // Read and verify final file
    const finalPath = path.join(tempDir, 'provider-instances.json');
    const finalContent = fs.readFileSync(finalPath, 'utf-8');

    // Check for corruption
    expect(finalContent).not.toContain('elConfig');
    expect(() => JSON.parse(finalContent)).not.toThrow();

    const parsed = JSON.parse(finalContent);
    expect(parsed.instances['test-instance'].modelConfig.disabledModels).toHaveLength(19);
  });

  it('should handle file system errors gracefully', async () => {
    // Skip on Windows as directory permissions work differently
    if (process.platform === 'win32') {
      return;
    }

    const config: ProviderInstancesConfig = {
      version: '1.0',
      instances: {
        'test-instance': {
          displayName: 'Test Instance',
          catalogProviderId: 'test-provider',
        },
      },
    };

    // Write initial content
    const configPath = path.join(tempDir, 'provider-instances.json');
    fs.writeFileSync(configPath, 'initial content');

    // Make the directory read-only to prevent writes (POSIX behavior)
    fs.chmodSync(tempDir, 0o555); // Read-only directory

    // This should throw but not corrupt
    await expect(manager.saveInstances(config)).rejects.toThrow();

    // Restore permissions and verify file is unchanged
    fs.chmodSync(tempDir, 0o755);
    const content = fs.readFileSync(configPath, 'utf-8');
    expect(content).toBe('initial content');
  });

  it('should handle interrupted writes without corruption', async () => {
    // This test simulates what might happen if the process is interrupted
    const config: ProviderInstancesConfig = {
      version: '1.0',
      instances: {
        'test-instance': {
          displayName: 'Test Instance',
          catalogProviderId: 'test-provider',
          modelConfig: {
            enableNewModels: true,
            disabledModels: [],
            disabledProviders: [],
            filters: {},
          },
        },
      },
    };

    // Save initial config
    await manager.saveInstances(config);

    // Create a .tmp file that simulates a failed previous write
    const tmpPath = path.join(tempDir, 'provider-instances.json.tmp');
    fs.writeFileSync(tmpPath, '{"partial": "data", "modelConfig": {');

    // Save should still work and clean up the tmp file
    await manager.saveInstances(config);

    // Verify the main file is valid
    const finalPath = path.join(tempDir, 'provider-instances.json');
    const finalContent = fs.readFileSync(finalPath, 'utf-8');
    expect(() => JSON.parse(finalContent)).not.toThrow();

    // Tmp file should be gone or overwritten
    if (fs.existsSync(tmpPath)) {
      const tmpContent = fs.readFileSync(tmpPath, 'utf-8');
      expect(tmpContent).not.toBe('{"partial": "data", "modelConfig": {');
    }
  });

  it('reproduces the elConfig corruption pattern', async () => {
    // This test tries to reproduce the exact corruption pattern seen
    const configWithModelConfig: ProviderInstancesConfig = {
      version: '1.0',
      instances: {
        'google-gemini-gemini': {
          displayName: 'Google Gemini',
          catalogProviderId: 'gemini',
          timeout: 30000,
          modelConfig: {
            enableNewModels: true,
            disabledModels: ['gemini-2.5-pro', 'gemini-2.5-flash'],
            disabledProviders: ['google gemini'],
            filters: {},
          },
        },
      },
    };

    // Write the initial config
    await manager.saveInstances(configWithModelConfig);

    // Simulate multiple components trying to update different instances simultaneously
    const promise1 = manager.saveInstances({
      ...configWithModelConfig,
      instances: {
        ...configWithModelConfig.instances,
        'new-instance-1': {
          displayName: 'New Instance 1',
          catalogProviderId: 'test',
          modelConfig: {
            enableNewModels: true,
            disabledModels: [],
            disabledProviders: [],
            filters: {},
          },
        },
      },
    });

    const promise2 = manager.saveInstances({
      ...configWithModelConfig,
      instances: {
        ...configWithModelConfig.instances,
        'new-instance-2': {
          displayName: 'New Instance 2',
          catalogProviderId: 'test',
          modelConfig: {
            enableNewModels: false,
            disabledModels: [],
            disabledProviders: [],
            filters: {},
          },
        },
      },
    });

    // Wait for both
    await Promise.all([promise1, promise2]);

    // Check the file
    const finalPath = path.join(tempDir, 'provider-instances.json');
    const finalContent = fs.readFileSync(finalPath, 'utf-8');

    // Log the content if corruption is detected
    if (
      finalContent.includes('elConfig') ||
      !finalContent.startsWith('{') ||
      !finalContent.endsWith('}')
    ) {
      console.error('CORRUPTION DETECTED:');
      console.error('File content:', finalContent);
      console.error('File length:', finalContent.length);
    }

    // Assertions
    expect(finalContent).not.toContain('elConfig');
    expect(finalContent[0]).toBe('{');
    expect(finalContent[finalContent.length - 1]).toBe('\n');
    expect(finalContent[finalContent.length - 2]).toBe('}');
  });
});
