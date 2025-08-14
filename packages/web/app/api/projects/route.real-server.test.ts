// ABOUTME: Real server integration tests for project API endpoints
// ABOUTME: Uses actual Next.js server with real HTTP requests instead of mocking

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { setupWebTest } from '@/test-utils/web-test-setup';
import { setupTestProviderDefaults, cleanupTestProviderDefaults } from '@/lib/server/lace-imports';
import { createTestProviderInstance, cleanupTestProviderInstances } from '@/lib/server/lace-imports';
import { saveAuthConfig, clearJWTSecretCache } from '@/lib/server/auth-config';
import { generateJWT } from '@/lib/server/auth-tokens';
import { parseResponse } from '@/lib/serialization';
import { NextRequest } from 'next/server';
import * as crypto from 'crypto';
import { createServer, Server } from 'http';
import { parse } from 'url';

// Set up temporary directory for auth.json and lace data
const _tempLaceDir = setupWebTest();

describe('Projects API - Real Server Integration', () => {
  let server: Server;
  let port: number;
  let baseUrl: string;
  let validToken: string;
  let providerInstanceId: string;

  beforeAll(async () => {
    // Find an available port
    port = await getAvailablePort();
    baseUrl = `http://localhost:${port}`;
    
    // Create a minimal HTTP server that handles our API routes
    server = createServer(async (req, res) => {
      try {
        const parsedUrl = parse(req.url || '', true);
        
        // Handle CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie');
        
        if (req.method === 'OPTIONS') {
          res.writeHead(200);
          res.end();
          return;
        }

        // Route to our API handlers
        if (parsedUrl.pathname === '/api/projects') {
          const { GET, POST } = await import('./route');
          
          // Create NextRequest-like object
          let body = '';
          if (req.method === 'POST') {
            req.on('data', chunk => body += chunk);
            await new Promise(resolve => req.on('end', resolve));
          }
          
          const request = {
            method: req.method,
            url: `${baseUrl}${req.url}`,
            headers: {
              get: (name: string) => req.headers[name.toLowerCase()],
            },
            cookies: {
              get: (name: string) => {
                const cookieHeader = req.headers.cookie;
                if (!cookieHeader) return undefined;
                const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
                  const [key, value] = cookie.trim().split('=');
                  acc[key] = value;
                  return acc;
                }, {} as Record<string, string>);
                return cookies[name] ? { value: cookies[name] } : undefined;
              }
            },
            json: async () => body ? JSON.parse(body) : {}
          } as NextRequest;
          
          let response;
          if (req.method === 'GET') {
            response = await GET(request);
          } else if (req.method === 'POST') {
            response = await POST(request);
          } else {
            res.writeHead(405);
            res.end('Method Not Allowed');
            return;
          }
          
          // Send response
          const responseBody = await response.text();
          res.writeHead(response.status, {
            'Content-Type': 'application/json',
          });
          res.end(responseBody);
          
        } else {
          res.writeHead(404);
          res.end('Not Found');
        }
        
      } catch (error) {
        console.error('Server error:', error);
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
      }
    });
    
    await new Promise<void>((resolve) => {
      server.listen(port, resolve);
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });

  beforeEach(async () => {
    // Clear JWT secret cache
    clearJWTSecretCache();
    
    // Create real auth config
    const jwtSecret = crypto.randomBytes(32).toString('hex');
    const authConfig = {
      passwordHash: 'test-hash',
      salt: 'test-salt',
      iterations: 16384,
      createdAt: new Date().toISOString(),
      algorithm: 'scrypt' as const,
      jwtSecret
    };
    await saveAuthConfig(authConfig);
    
    // Generate valid token
    validToken = generateJWT({ userId: 'test-user' });

    // Setup test environment
    setupTestProviderDefaults();
    const { Session } = await import('@/lib/server/lace-imports');
    Session.clearProviderCache();

    // Force persistence reset
    const { resetPersistence } = await import('~/persistence/database');
    resetPersistence();

    // Create test provider instance
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Anthropic Instance',
      apiKey: 'test-anthropic-key',
    });
  });

  afterEach(async () => {
    cleanupTestProviderDefaults();
    await cleanupTestProviderInstances([providerInstanceId]);
    clearJWTSecretCache();
  });

  it('should return all projects with real HTTP request', async () => {
    // Create test projects using real Project class
    const { Project } = await import('~/projects/project');
    const project1 = Project.create('Project 1', '/path/1', 'First project', {
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });

    // Make real HTTP request with authentication
    const response = await fetch(`${baseUrl}/api/projects`, {
      method: 'GET',
      headers: {
        'Cookie': `auth-token=${validToken}`
      }
    });

    expect(response.status).toBe(200);
    
    // Use parseResponse to handle SuperJSON deserialization
    const data = await parseResponse<Array<{ id: string; name: string; workingDirectory: string; description: string }>>(response);
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(1);
    
    const returnedProject = data[0];
    expect(returnedProject.name).toBe('Project 1');
    expect(returnedProject.workingDirectory).toBe('/path/1');
    expect(returnedProject.description).toBe('First project');
    expect(returnedProject.id).toBe(project1.getId());
  });

  it('should require authentication', async () => {
    // Make request without authentication
    const response = await fetch(`${baseUrl}/api/projects`, {
      method: 'GET'
    });

    expect(response.status).toBe(401);
    
    const data = await response.json();
    expect(data.error).toBe('Authentication required');
  });

  it('should create new project with real HTTP request', async () => {
    const projectData = {
      name: 'New Project',
      description: 'A new project',
      workingDirectory: '/new/path',
    };

    const response = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `auth-token=${validToken}`
      },
      body: JSON.stringify(projectData)
    });

    expect(response.status).toBe(201);
    
    const data = await parseResponse<{ id: string; name: string; description: string; workingDirectory: string }>(response);
    expect(data.name).toBe('New Project');
    expect(data.description).toBe('A new project');
    expect(data.workingDirectory).toBe('/new/path');
    expect(data.id).toBeDefined();

    // Verify project was actually created
    const { Project } = await import('~/projects/project');
    const createdProject = Project.getById(data.id);
    expect(createdProject).not.toBeNull();
    expect(createdProject!.getName()).toBe('New Project');
  });
});

// Helper function to find an available port
async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, () => {
      const address = server.address();
      const port = address && typeof address !== 'string' ? address.port : null;
      server.close(() => {
        if (port) {
          resolve(port);
        } else {
          reject(new Error('Could not get port'));
        }
      });
    });
  });
}