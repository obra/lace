// ABOUTME: Integration tests for web companion functionality focused on end-to-end behavior
// ABOUTME: Tests the web companion through HTTP requests and WebSocket connections without internal imports

import { describe, test, beforeAll, afterAll, expect } from '@jest/globals';
import request from 'supertest';
import { io as Client } from 'socket.io-client';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';

describe('Web Companion Integration Tests', () => {
  let laceProcess;
  let testPort = 3002;
  let baseUrl = `http://localhost:${testPort}`;

  // Helper to wait for server to be ready
  const waitForServer = async (url, maxAttempts = 20) => {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch(`${url}/api/health`);
        if (response.ok) return true;
      } catch (error) {
        // Server not ready yet
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error('Server did not start within timeout');
  };

  beforeAll(async () => {
    // Start Lace with web companion
    laceProcess = spawn('node', ['src/cli.js', '--web-port', testPort.toString(), '--verbose'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' }
    });

    // Wait for server to start
    await waitForServer(baseUrl);
  }, 30000);

  afterAll(async () => {
    if (laceProcess) {
      laceProcess.kill('SIGTERM');
      
      // Wait for process to exit
      await new Promise((resolve) => {
        laceProcess.on('exit', resolve);
        setTimeout(() => {
          laceProcess.kill('SIGKILL');
          resolve();
        }, 5000);
      });
    }
  });

  describe('HTTP API Endpoints', () => {
    test('should respond to health check', async () => {
      const response = await request(baseUrl)
        .get('/api/health')
        .expect(200);
      
      expect(response.body.status).toBe('ok');
      expect(response.body.timestamp).toBeDefined();
      expect(typeof response.body.connectedClients).toBe('number');
    });

    test('should serve sessions endpoint', async () => {
      const response = await request(baseUrl)
        .get('/api/sessions')
        .expect(200);
      
      expect(Array.isArray(response.body)).toBe(true);
    });

    test('should handle session messages endpoint', async () => {
      const response = await request(baseUrl)
        .get('/api/sessions/test-session/messages')
        .expect(200);
      
      expect(Array.isArray(response.body)).toBe(true);
    });

    test('should handle session stats endpoint', async () => {
      const response = await request(baseUrl)
        .get('/api/sessions/test-session/stats')
        .expect(200);
      
      expect(response.body.messageCount).toBeDefined();
      expect(response.body.tokenStats).toBeDefined();
    });

    test('should serve static files', async () => {
      const response = await request(baseUrl)
        .get('/')
        .expect(200);
      
      expect(response.text).toContain('Lace Web Companion');
    });
  });

  describe('WebSocket Connectivity', () => {
    test('should accept WebSocket connections', (done) => {
      const client = Client(baseUrl);
      
      client.on('connect', () => {
        expect(client.connected).toBe(true);
        client.disconnect();
        done();
      });
      
      client.on('connect_error', (error) => {
        done(error);
      });
    });

    test('should handle connection and disconnection', (done) => {
      const client = Client(baseUrl);
      let connected = false;
      
      client.on('connect', () => {
        connected = true;
        client.disconnect();
      });
      
      client.on('disconnect', () => {
        expect(connected).toBe(true);
        done();
      });
      
      client.on('connect_error', done);
    });

    test('should support event filtering', (done) => {
      const client = Client(baseUrl);
      
      client.on('connect', () => {
        // Test that we can emit filter events without errors
        client.emit('filter-activity', { eventType: 'user_input' });
        
        setTimeout(() => {
          client.disconnect();
          done();
        }, 100);
      });
      
      client.on('connect_error', done);
    });

    test('should support session subscription', (done) => {
      const client = Client(baseUrl);
      
      client.on('connect', () => {
        // Test that we can emit session subscription without errors
        client.emit('subscribe-session', 'test-session-id');
        
        setTimeout(() => {
          client.emit('unsubscribe-session');
          client.disconnect();
          done();
        }, 100);
      });
      
      client.on('connect_error', done);
    });
  });

  describe('Error Handling', () => {
    test('should handle 404 for unknown API endpoints', async () => {
      await request(baseUrl)
        .get('/api/nonexistent')
        .expect(404);
    });

    test('should handle malformed requests gracefully', async () => {
      const response = await request(baseUrl)
        .get('/api/sessions/invalid-session-id/messages')
        .expect(200);
      
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(0);
    });
  });
});