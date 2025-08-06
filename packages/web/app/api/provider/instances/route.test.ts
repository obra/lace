// ABOUTME: Tests for provider instances API endpoint (GET/POST /api/provider/instances)
// ABOUTME: Verifies instance listing and creation with real implementations

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GET, POST } from './route';
import { parseResponse } from '@/lib/serialization';
import type { ProviderInstancesConfig } from '@/lib/server/lace-imports';
import type { ConfiguredInstance } from '@/lib/server/lace-imports';
import type { InstancesResponse, CreateInstanceResponse } from './route';

describe('Provider Instances API', () => {
  let tempDir: string;
  let originalLaceDir: string | undefined;

  beforeEach(() => {
    // Create temp directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-test-'));
    originalLaceDir = process.env.LACE_DIR;
    process.env.LACE_DIR = tempDir;
  });

  afterEach(() => {
    // Cleanup
    if (originalLaceDir) {
      process.env.LACE_DIR = originalLaceDir;
    } else {
      delete process.env.LACE_DIR;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('GET /api/provider/instances', () => {
    it('should return configured instances', async () => {
      // Set up test instance configuration
      const config: ProviderInstancesConfig = {
        version: '1.0',
        instances: {
          'openai-prod': {
            displayName: 'OpenAI Production',
            catalogProviderId: 'openai',
          },
          'anthropic-dev': {
            displayName: 'Anthropic Development',
            catalogProviderId: 'anthropic',
            timeout: 30000,
          },
        },
      };

      fs.writeFileSync(
        path.join(tempDir, 'provider-instances.json'),
        JSON.stringify(config, null, 2)
      );

      const mockRequest = {} as NextRequest;
      const response = await GET(mockRequest);
      const data = await parseResponse<InstancesResponse>(response);

      expect(response.status).toBe(200);
      expect(data.instances).toHaveLength(2);
      expect(data.instances[0]).toMatchObject({
        id: 'openai-prod',
        displayName: 'OpenAI Production',
        catalogProviderId: 'openai',
        hasCredentials: false, // No credentials set up
      });
      expect(data.instances[1]).toMatchObject({
        id: 'anthropic-dev',
        displayName: 'Anthropic Development',
        catalogProviderId: 'anthropic',
        timeout: 30000,
        hasCredentials: false, // No credentials set up
      });
    });

    it('should handle empty instances list when no config file exists', async () => {
      const mockRequest = {} as NextRequest;
      const response = await GET(mockRequest);
      const data = await parseResponse<InstancesResponse>(response);

      expect(response.status).toBe(200);
      expect(data.instances).toEqual([]);
    });

    it('should handle corrupted config file gracefully', async () => {
      // Write invalid JSON
      fs.writeFileSync(path.join(tempDir, 'provider-instances.json'), 'invalid json{');

      const mockRequest = {} as NextRequest;
      const response = await GET(mockRequest);
      const data = await parseResponse<InstancesResponse>(response);

      expect(response.status).toBe(200);
      expect(data.instances).toEqual([]);
    });

    it('should correctly detect hasCredentials when credentials exist', async () => {
      // Set up test instance configuration
      const config: ProviderInstancesConfig = {
        version: '1.0',
        instances: {
          'with-creds': {
            displayName: 'Instance With Credentials',
            catalogProviderId: 'openai',
          },
          'without-creds': {
            displayName: 'Instance Without Credentials',
            catalogProviderId: 'anthropic',
          },
        },
      };

      fs.writeFileSync(
        path.join(tempDir, 'provider-instances.json'),
        JSON.stringify(config, null, 2)
      );

      // Set up credential for only one instance
      const credentialsDir = path.join(tempDir, 'credentials');
      fs.mkdirSync(credentialsDir, { recursive: true });
      fs.writeFileSync(
        path.join(credentialsDir, 'with-creds.json'),
        JSON.stringify({ apiKey: 'test-key' }, null, 2)
      );

      const mockRequest = {} as NextRequest;
      const response = await GET(mockRequest);
      const data = await parseResponse<InstancesResponse>(response);

      expect(response.status).toBe(200);
      expect(data.instances).toHaveLength(2);

      const withCreds = data.instances.find((i: ConfiguredInstance) => i.id === 'with-creds');
      const withoutCreds = data.instances.find((i: ConfiguredInstance) => i.id === 'without-creds');

      expect(withCreds).toMatchObject({
        id: 'with-creds',
        displayName: 'Instance With Credentials',
        hasCredentials: true,
      });

      expect(withoutCreds).toMatchObject({
        id: 'without-creds',
        displayName: 'Instance Without Credentials',
        hasCredentials: false,
      });
    });

    it('should handle instances with minimal configuration', async () => {
      // Set up test instance with minimal fields
      const config: ProviderInstancesConfig = {
        version: '1.0',
        instances: {
          'minimal-instance': {
            displayName: 'Minimal Instance',
            catalogProviderId: 'openai',
            // No endpoint, timeout, or retryPolicy
          },
        },
      };

      fs.writeFileSync(
        path.join(tempDir, 'provider-instances.json'),
        JSON.stringify(config, null, 2)
      );

      const mockRequest = {} as NextRequest;
      const response = await GET(mockRequest);
      const data = await parseResponse<InstancesResponse>(response);

      expect(response.status).toBe(200);
      expect(data.instances).toHaveLength(1);
      expect(data.instances[0]).toMatchObject({
        id: 'minimal-instance',
        displayName: 'Minimal Instance',
        catalogProviderId: 'openai',
        hasCredentials: false,
      });

      // Verify optional fields are undefined (not included in response)
      expect(data.instances[0].endpoint).toBeUndefined();
      expect(data.instances[0].retryPolicy).toBeUndefined();
      // timeout should be undefined if not set (registry might set default, test actual behavior)
    });
  });

  describe('POST /api/provider/instances', () => {
    it('should create a new provider instance', async () => {
      const requestBody = {
        instanceId: 'openai-test',
        displayName: 'OpenAI Test',
        catalogProviderId: 'openai',
        credential: {
          apiKey: 'sk-test123',
        },
        timeout: 30000,
      };

      const mockRequest = {
        json: async () => requestBody,
      } as NextRequest;

      const response = await POST(mockRequest);
      const data = await parseResponse<CreateInstanceResponse>(response);

      expect(response.status).toBe(201);
      expect(data).toMatchObject({
        success: true,
        instanceId: 'openai-test',
      });

      // Verify instance was saved to file
      const configPath = path.join(tempDir, 'provider-instances.json');
      expect(fs.existsSync(configPath)).toBe(true);

      const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(savedConfig.instances['openai-test']).toMatchObject({
        displayName: 'OpenAI Test',
        catalogProviderId: 'openai',
        timeout: 30000,
      });

      // Verify credential was saved
      const credentialPath = path.join(tempDir, 'credentials', 'openai-test.json');
      expect(fs.existsSync(credentialPath)).toBe(true);

      const savedCredential = JSON.parse(fs.readFileSync(credentialPath, 'utf-8'));
      expect(savedCredential).toMatchObject({
        apiKey: 'sk-test123',
      });

      // Verify instance appears in GET with correct contract
      const getResponse = await GET({} as NextRequest);
      const getData = await parseResponse<InstancesResponse>(getResponse);

      expect(getData.instances).toHaveLength(1);
      expect(getData.instances[0]).toMatchObject({
        id: 'openai-test',
        displayName: 'OpenAI Test',
        catalogProviderId: 'openai',
        timeout: 30000,
        hasCredentials: true, // Should be true since we saved credentials
      });
    });

    it('should reject invalid request body', async () => {
      const invalidBody = {
        instanceId: '', // Invalid: empty string
        displayName: 'Test',
        catalogProviderId: 'openai',
      };

      const mockRequest = {
        json: async () => invalidBody,
      } as NextRequest;

      const response = await POST(mockRequest);
      const data = await parseResponse<{ error: string }>(response);

      expect(response.status).toBe(400);
      expect(data.error).toContain('Invalid request body');
    });

    it('should reject non-existent catalog provider', async () => {
      const requestBody = {
        instanceId: 'unknown-test',
        displayName: 'Unknown Test',
        catalogProviderId: 'nonexistent',
        credential: { apiKey: 'test' },
      };

      const mockRequest = {
        json: async () => requestBody,
      } as NextRequest;

      const response = await POST(mockRequest);
      const data = await parseResponse<{ error: string }>(response);

      expect(response.status).toBe(400);
      expect(data.error).toBe('Provider not found in catalog: nonexistent');
    });

    it('should reject duplicate instance IDs', async () => {
      // Set up existing instance
      const existingConfig: ProviderInstancesConfig = {
        version: '1.0',
        instances: {
          'existing-instance': {
            displayName: 'Existing Instance',
            catalogProviderId: 'openai',
          },
        },
      };

      fs.writeFileSync(
        path.join(tempDir, 'provider-instances.json'),
        JSON.stringify(existingConfig, null, 2)
      );

      const requestBody = {
        instanceId: 'existing-instance',
        displayName: 'Duplicate Test',
        catalogProviderId: 'openai',
        credential: { apiKey: 'test' },
      };

      const mockRequest = {
        json: async () => requestBody,
      } as NextRequest;

      const response = await POST(mockRequest);
      const data = await parseResponse<{ error: string }>(response);

      expect(response.status).toBe(400);
      expect(data.error).toBe('Instance ID already exists: existing-instance');
    });
  });
});
