// ABOUTME: Tests for individual provider instance API endpoint (GET/DELETE /api/provider/instances/[instanceId])
// ABOUTME: Verifies instance retrieval and deletion with real implementations

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GET, DELETE, PUT } from './route';
import { parseResponse } from '@/lib/serialization';
import { ProviderRegistry } from '@/lib/server/lace-imports';
import type { ProviderInstancesConfig } from '@/lib/server/lace-imports';
import type {
  InstanceDetailResponse,
  DeleteInstanceResponse,
  UpdateInstanceResponse,
} from './route';

describe('Provider Instance Detail API', () => {
  let tempDir: string;
  let originalLaceDir: string | undefined;

  beforeEach(() => {
    // Clear Registry singleton to ensure clean state
    ProviderRegistry.clearInstance();

    // Create temp directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-test-'));
    originalLaceDir = process.env.LACE_DIR;
    process.env.LACE_DIR = tempDir;
  });

  afterEach(() => {
    // Clear Registry singleton to prevent state leakage
    ProviderRegistry.clearInstance();

    // Cleanup
    if (originalLaceDir) {
      process.env.LACE_DIR = originalLaceDir;
    } else {
      delete process.env.LACE_DIR;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('GET /api/provider/instances/[instanceId]', () => {
    it('should return specific instance details', async () => {
      // Set up test instance configuration
      const config: ProviderInstancesConfig = {
        version: '1.0',
        instances: {
          'test-instance': {
            displayName: 'Test Instance',
            catalogProviderId: 'openai',
            timeout: 30000,
            endpoint: 'https://api.openai.com/v1',
          },
        },
      };

      fs.writeFileSync(
        path.join(tempDir, 'provider-instances.json'),
        JSON.stringify(config, null, 2)
      );

      const mockRequest = {} as NextRequest;
      const response = await GET(mockRequest, {
        params: Promise.resolve({ instanceId: 'test-instance' }),
      });
      const data = await parseResponse<InstanceDetailResponse>(response);

      expect(response.status).toBe(200);
      expect(data.instance).toMatchObject({
        id: 'test-instance',
        displayName: 'Test Instance',
        catalogProviderId: 'openai',
        timeout: 30000,
        endpoint: 'https://api.openai.com/v1',
        hasCredentials: false, // No credentials in this test
      });
    });

    it('should return 404 for non-existent instance', async () => {
      const mockRequest = {} as NextRequest;
      const response = await GET(mockRequest, {
        params: Promise.resolve({ instanceId: 'nonexistent' }),
      });
      const data = await parseResponse<{ error: string }>(response);

      expect(response.status).toBe(404);
      expect(data.error).toBe('Instance not found: nonexistent');
    });
  });

  describe('DELETE /api/provider/instances/[instanceId]', () => {
    it('should delete instance and credentials', async () => {
      // Set up test instance configuration
      const config: ProviderInstancesConfig = {
        version: '1.0',
        instances: {
          'test-instance': {
            displayName: 'Test Instance',
            catalogProviderId: 'openai',
          },
          'other-instance': {
            displayName: 'Other Instance',
            catalogProviderId: 'anthropic',
          },
        },
      };

      fs.writeFileSync(
        path.join(tempDir, 'provider-instances.json'),
        JSON.stringify(config, null, 2)
      );

      // Set up test credential
      const credentialsDir = path.join(tempDir, 'credentials');
      fs.mkdirSync(credentialsDir, { recursive: true });
      fs.writeFileSync(
        path.join(credentialsDir, 'test-instance.json'),
        JSON.stringify({ apiKey: 'test-key' }, null, 2)
      );

      const mockRequest = {} as NextRequest;
      const response = await DELETE(mockRequest, {
        params: Promise.resolve({ instanceId: 'test-instance' }),
      });
      const data = await parseResponse<DeleteInstanceResponse>(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify instance was removed from config
      const updatedConfig = JSON.parse(
        fs.readFileSync(path.join(tempDir, 'provider-instances.json'), 'utf-8')
      );
      expect(updatedConfig.instances['test-instance']).toBeUndefined();
      expect(updatedConfig.instances['other-instance']).toBeDefined();

      // Verify credential file was deleted
      const credentialPath = path.join(credentialsDir, 'test-instance.json');
      expect(fs.existsSync(credentialPath)).toBe(false);
    });

    it('should return 404 for non-existent instance', async () => {
      const mockRequest = {} as NextRequest;
      const response = await DELETE(mockRequest, {
        params: Promise.resolve({ instanceId: 'nonexistent' }),
      });
      const data = await parseResponse<{ error: string }>(response);

      expect(response.status).toBe(404);
      expect(data.error).toBe('Instance not found: nonexistent');
    });

    it('should handle missing credential file gracefully', async () => {
      // Set up test instance configuration without credential file
      const config: ProviderInstancesConfig = {
        version: '1.0',
        instances: {
          'test-instance': {
            displayName: 'Test Instance',
            catalogProviderId: 'openai',
          },
        },
      };

      fs.writeFileSync(
        path.join(tempDir, 'provider-instances.json'),
        JSON.stringify(config, null, 2)
      );

      const mockRequest = {} as NextRequest;
      const response = await DELETE(mockRequest, {
        params: Promise.resolve({ instanceId: 'test-instance' }),
      });
      const data = await parseResponse<DeleteInstanceResponse>(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify instance was still removed from config
      const updatedConfig = JSON.parse(
        fs.readFileSync(path.join(tempDir, 'provider-instances.json'), 'utf-8')
      );
      expect(updatedConfig.instances['test-instance']).toBeUndefined();
    });
  });

  describe('PUT /api/provider/instances/[instanceId]', () => {
    it('should update instance configuration only', async () => {
      // Set up test instance configuration
      const config: ProviderInstancesConfig = {
        version: '1.0',
        instances: {
          'test-instance': {
            displayName: 'Original Name',
            catalogProviderId: 'openai',
            timeout: 30000,
            endpoint: 'https://api.openai.com/v1',
          },
        },
      };

      fs.writeFileSync(
        path.join(tempDir, 'provider-instances.json'),
        JSON.stringify(config, null, 2)
      );

      const updateData = {
        displayName: 'Updated Instance Name',
        timeout: 60000,
        endpoint: 'https://custom.openai.com/v1',
      };

      const mockRequest = {
        json: async () => updateData,
      } as NextRequest;

      const response = await PUT(mockRequest, {
        params: Promise.resolve({ instanceId: 'test-instance' }),
      });
      const data = await parseResponse<UpdateInstanceResponse>(response);

      expect(response.status).toBe(200);
      expect(data.instance).toMatchObject({
        id: 'test-instance',
        displayName: 'Updated Instance Name',
        catalogProviderId: 'openai', // Should remain unchanged
        timeout: 60000,
        endpoint: 'https://custom.openai.com/v1',
        hasCredentials: false, // No credentials in this test
      });

      // Verify changes were persisted
      const updatedConfig = JSON.parse(
        fs.readFileSync(path.join(tempDir, 'provider-instances.json'), 'utf-8')
      );
      expect(updatedConfig.instances['test-instance']).toMatchObject({
        displayName: 'Updated Instance Name',
        catalogProviderId: 'openai',
        timeout: 60000,
        endpoint: 'https://custom.openai.com/v1',
      });
    });

    it('should update credentials when provided', async () => {
      // Set up test instance configuration
      const config: ProviderInstancesConfig = {
        version: '1.0',
        instances: {
          'test-instance': {
            displayName: 'Test Instance',
            catalogProviderId: 'openai',
          },
        },
      };

      fs.writeFileSync(
        path.join(tempDir, 'provider-instances.json'),
        JSON.stringify(config, null, 2)
      );

      // Set up existing credential
      const credentialsDir = path.join(tempDir, 'credentials');
      fs.mkdirSync(credentialsDir, { recursive: true });
      fs.writeFileSync(
        path.join(credentialsDir, 'test-instance.json'),
        JSON.stringify({ apiKey: 'old-key' }, null, 2)
      );

      const updateData = {
        displayName: 'Updated Name',
        credential: { apiKey: 'new-api-key' },
      };

      const mockRequest = {
        json: async () => updateData,
      } as NextRequest;

      const response = await PUT(mockRequest, {
        params: Promise.resolve({ instanceId: 'test-instance' }),
      });
      const data = await parseResponse<UpdateInstanceResponse>(response);

      expect(response.status).toBe(200);
      expect(data.instance).toMatchObject({
        id: 'test-instance',
        displayName: 'Updated Name',
        catalogProviderId: 'openai',
        hasCredentials: true, // Should be true after credential update
      });

      // Verify credential was updated
      const updatedCredential = JSON.parse(
        fs.readFileSync(path.join(credentialsDir, 'test-instance.json'), 'utf-8')
      );
      expect(updatedCredential.apiKey).toBe('new-api-key');
    });

    it('should return 404 for non-existent instance', async () => {
      const updateData = {
        displayName: 'Updated Name',
      };

      const mockRequest = {
        json: async () => updateData,
      } as NextRequest;

      const response = await PUT(mockRequest, {
        params: Promise.resolve({ instanceId: 'nonexistent' }),
      });
      const data = await parseResponse<{ error: string }>(response);

      expect(response.status).toBe(404);
      expect(data.error).toBe('Instance not found: nonexistent');
    });

    it('should validate required fields', async () => {
      // Set up test instance
      const config: ProviderInstancesConfig = {
        version: '1.0',
        instances: {
          'test-instance': {
            displayName: 'Test Instance',
            catalogProviderId: 'openai',
          },
        },
      };

      fs.writeFileSync(
        path.join(tempDir, 'provider-instances.json'),
        JSON.stringify(config, null, 2)
      );

      const updateData = {
        displayName: '', // Invalid: empty string
      };

      const mockRequest = {
        json: async () => updateData,
      } as NextRequest;

      const response = await PUT(mockRequest, {
        params: Promise.resolve({ instanceId: 'test-instance' }),
      });

      expect(response.status).toBe(400);
    });

    it('should not allow changing catalogProviderId', async () => {
      // Set up test instance
      const config: ProviderInstancesConfig = {
        version: '1.0',
        instances: {
          'test-instance': {
            displayName: 'Test Instance',
            catalogProviderId: 'openai',
          },
        },
      };

      fs.writeFileSync(
        path.join(tempDir, 'provider-instances.json'),
        JSON.stringify(config, null, 2)
      );

      const updateData = {
        displayName: 'Updated Name',
        catalogProviderId: 'anthropic', // Should be ignored
      };

      const mockRequest = {
        json: async () => updateData,
      } as NextRequest;

      const response = await PUT(mockRequest, {
        params: Promise.resolve({ instanceId: 'test-instance' }),
      });
      const data = await parseResponse<UpdateInstanceResponse>(response);

      expect(response.status).toBe(200);
      // catalogProviderId should remain unchanged
      expect(data.instance.catalogProviderId).toBe('openai');

      // Verify it wasn't changed in persistence
      const updatedConfig = JSON.parse(
        fs.readFileSync(path.join(tempDir, 'provider-instances.json'), 'utf-8')
      );
      expect(updatedConfig.instances['test-instance'].catalogProviderId).toBe('openai');
    });
  });
});
