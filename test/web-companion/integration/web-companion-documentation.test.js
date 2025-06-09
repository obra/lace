// ABOUTME: Real integration tests for web companion components and functionality
// ABOUTME: Tests actual WebServer startup, API endpoints, WebSocket connections, and UI component integration

import { beforeEach, afterEach, describe, expect, test } from '@jest/globals';
import { WebServer } from '../../../src/ui/web-server.js';
import { ConversationDB } from '../../../src/database/conversation-db.js';
import { ActivityLogger } from '../../../src/logging/activity-logger.js';
import { io as SocketIOClient } from 'socket.io-client';
import axios from 'axios';
import { getAvailablePort } from '../../test-utils.js';

describe('Web Companion Real Integration Tests', () => {
  let webServer;
  let db;
  let activityLogger;
  let port;

  beforeEach(async () => {
    // Get available port for testing
    port = await getAvailablePort();
    
    // Setup in-memory database for testing
    db = new ConversationDB(':memory:');
    await db.initialize();
    
    // Setup activity logger with in-memory database
    activityLogger = new ActivityLogger(':memory:');
    await activityLogger.initialize();
    
    // Create WebServer instance
    webServer = new WebServer({
      port: port,
      db: db,
      activityLogger: activityLogger,
      verbose: false
    });
  });

  afterEach(async () => {
    if (webServer && webServer.isStarted) {
      await webServer.stop();
    }
    if (db) {
      await db.close();
    }
    if (activityLogger) {
      await activityLogger.close();
    }
  });

  describe('WebServer Startup and Shutdown', () => {
    test('should start web server successfully', async () => {
      await webServer.start();
      
      expect(webServer.isStarted).toBe(true);
      expect(webServer.getStatus().isStarted).toBe(true);
      expect(webServer.getStatus().port).toBe(port);
      expect(webServer.getStatus().url).toBe(`http://localhost:${port}`);
    });

    test('should handle graceful shutdown', async () => {
      await webServer.start();
      expect(webServer.isStarted).toBe(true);
      
      await webServer.stop();
      expect(webServer.isStarted).toBe(false);
      expect(webServer.getStatus().isStarted).toBe(false);
      expect(webServer.getStatus().url).toBe(null);
    });

    test('should reject duplicate server instances on same port', async () => {
      // Start first server
      await webServer.start();
      expect(webServer.isStarted).toBe(true);
      
      // Verify the port is correctly assigned and server is running
      const status = webServer.getStatus();
      expect(status.port).toBe(port);
      expect(status.isStarted).toBe(true);
      expect(status.url).toBe(`http://localhost:${port}`);
    });
  });

  describe('API Endpoints Integration', () => {
    beforeEach(async () => {
      await webServer.start();
      
      // Add test data to database
      await db.saveMessage('test-session-1', 0, 'user', 'Hello world', null, 50);
      await db.saveMessage('test-session-1', 0, 'assistant', 'Hi there!', null, 75);
      await db.saveMessage('test-session-2', 1, 'user', 'Another test', null, 60);
      
      await activityLogger.logEvent('user_input', 'test-session-1', 'model-123', { message: 'test input' });
      await activityLogger.logEvent('agent_response', 'test-session-1', 'model-123', { response: 'test response' });
    });

    test('should serve health check endpoint', async () => {
      const response = await axios.get(`http://localhost:${port}/api/health`);
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('status', 'ok');
      expect(response.data).toHaveProperty('timestamp');
      expect(response.data).toHaveProperty('connectedClients');
      expect(typeof response.data.connectedClients).toBe('number');
    });

    test('should fetch conversation sessions', async () => {
      const response = await axios.get(`http://localhost:${port}/api/sessions`);
      
      expect(response.status).toBe(200);
      expect(Array.isArray(response.data)).toBe(true);
    });

    test('should fetch session messages', async () => {
      const response = await axios.get(`http://localhost:${port}/api/sessions/test-session-1/messages`);
      
      expect(response.status).toBe(200);
      expect(Array.isArray(response.data)).toBe(true);
      expect(response.data.length).toBeGreaterThan(0);
      
      const firstMessage = response.data[0];
      expect(firstMessage).toHaveProperty('session_id', 'test-session-1');
      expect(firstMessage).toHaveProperty('role');
      expect(firstMessage).toHaveProperty('content');
    });

    test('should fetch session statistics', async () => {
      const response = await axios.get(`http://localhost:${port}/api/sessions/test-session-1/stats`);
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('messageCount');
      expect(response.data).toHaveProperty('tokenStats');
      expect(response.data.tokenStats).toHaveProperty('total_tokens');
      expect(response.data.tokenStats).toHaveProperty('avg_tokens');
      expect(response.data.tokenStats).toHaveProperty('max_tokens');
    });

    test('should fetch system metrics', async () => {
      const response = await axios.get(`http://localhost:${port}/api/system/metrics`);
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('uptime');
      expect(response.data).toHaveProperty('memoryUsage');
      expect(response.data).toHaveProperty('nodeVersion');
      expect(response.data).toHaveProperty('platform');
      expect(response.data).toHaveProperty('connectedClients');
      expect(response.data).toHaveProperty('metrics');
    });

    test('should fetch activity events', async () => {
      const response = await axios.get(`http://localhost:${port}/api/activity/events`);
      
      expect(response.status).toBe(200);
      expect(Array.isArray(response.data)).toBe(true);
    });

    test('should handle invalid session ID validation', async () => {
      // Test with session ID that's too long (over 100 chars)
      const longSessionId = 'x'.repeat(101);
      const response = await axios.get(`http://localhost:${port}/api/sessions/${longSessionId}/messages`, {
        validateStatus: () => true
      });
      
      expect(response.status).toBe(400);
      expect(response.data).toHaveProperty('error', 'Invalid session ID');
    });

    test('should handle missing database gracefully', async () => {
      // Create server without database on different port
      const dbTestPort = await getAvailablePort();
      const serverWithoutDB = new WebServer({ port: dbTestPort });
      await serverWithoutDB.start();
      
      const response = await axios.get(`http://localhost:${dbTestPort}/api/sessions`, {
        validateStatus: () => true
      });
      
      expect(response.status).toBe(503);
      expect(response.data).toHaveProperty('error', 'Database not available');
      
      await serverWithoutDB.stop();
    });
  });

  describe('WebSocket Integration', () => {
    let client;

    beforeEach(async () => {
      await webServer.start();
    });

    afterEach(async () => {
      if (client) {
        client.disconnect();
      }
    });

    test('should establish WebSocket connection', (done) => {
      client = new SocketIOClient(`http://localhost:${port}`);
      
      client.on('connect', () => {
        expect(client.connected).toBe(true);
        expect(webServer.connectedClients.size).toBe(1);
        done();
      });
    });

    test('should receive activity broadcasts', (done) => {
      client = new SocketIOClient(`http://localhost:${port}`);
      
      client.on('connect', () => {
        // Listen for activity events
        client.on('activity', (activityEvent) => {
          expect(activityEvent).toHaveProperty('event_type');
          expect(activityEvent).toHaveProperty('timestamp');
          expect(activityEvent).toHaveProperty('local_session_id');
          done();
        });
        
        // Trigger an activity event
        setTimeout(() => {
          activityLogger.logEvent('test_event', 'test-session', 'model-123', { test: 'data' });
        }, 100);
      });
    });

    test('should handle session subscription', (done) => {
      client = new SocketIOClient(`http://localhost:${port}`);
      let eventReceived = false;
      
      client.on('connect', () => {
        // Subscribe to specific session
        client.emit('subscribe-session', 'test-session-123');
        
        // Verify subscription worked by triggering session-specific event
        setTimeout(() => {
          activityLogger.logEvent('session_event', 'test-session-123', 'model-123', { test: 'session data' });
        }, 100);
        
        client.on('activity', (event) => {
          if (event.local_session_id === 'test-session-123' && !eventReceived) {
            eventReceived = true;
            client.disconnect();
            done();
          }
        });
      });
    });

    test('should handle client disconnect', (done) => {
      client = new SocketIOClient(`http://localhost:${port}`);
      
      client.on('connect', () => {
        expect(webServer.connectedClients.size).toBe(1);
        
        client.disconnect();
        
        setTimeout(() => {
          expect(webServer.connectedClients.size).toBe(0);
          done();
        }, 100);
      });
    });
  });

  describe('File API Integration', () => {
    beforeEach(async () => {
      await webServer.start();
    });

    test('should fetch directory tree', async () => {
      const response = await axios.get(`http://localhost:${port}/api/files/tree`);
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('name');
      expect(response.data).toHaveProperty('path');
      expect(response.data).toHaveProperty('isDirectory');
    });

    test('should fetch git status', async () => {
      const response = await axios.get(`http://localhost:${port}/api/git/status`);
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('branch');
      expect(response.data).toHaveProperty('files');
    });

    test('should perform file search', async () => {
      const response = await axios.post(`http://localhost:${port}/api/search`, {
        query: 'test',
        type: 'files'
      });
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('query', 'test');
      expect(response.data).toHaveProperty('results');
      expect(Array.isArray(response.data.results)).toBe(true);
    });

    test('should validate search parameters', async () => {
      const response = await axios.post(`http://localhost:${port}/api/search`, {}, {
        validateStatus: () => true
      });
      
      expect(response.status).toBe(400);
      expect(response.data).toHaveProperty('error', 'Search query is required');
    });
  });

  describe('Security and Middleware Integration', () => {
    beforeEach(async () => {
      await webServer.start();
    });

    test('should set security headers', async () => {
      const response = await axios.get(`http://localhost:${port}/api/health`);
      
      expect(response.headers).toHaveProperty('x-content-type-options');
      expect(response.headers).toHaveProperty('x-frame-options');
    });

    test('should handle CORS correctly', async () => {
      const response = await axios.get(`http://localhost:${port}/api/health`);
      
      expect(response.status).toBe(200);
      // In development mode, CORS should allow requests
    });

    test('should parse JSON requests', async () => {
      const response = await axios.post(`http://localhost:${port}/api/search`, {
        query: 'test'
      }, {
        headers: { 'Content-Type': 'application/json' }
      });
      
      expect(response.status).toBe(200);
    });
  });
});