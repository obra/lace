// ABOUTME: Real API endpoint tests with actual HTTP requests and responses
// ABOUTME: Tests all WebServer REST API endpoints with actual server instances and database integration

import { beforeEach, afterEach, describe, expect, test } from '@jest/globals';
import { WebServer } from '../../../src/interface/web-server.js';
import { ConversationDB } from '../../../src/database/conversation-db.js';
import { ActivityLogger } from '../../../src/logging/activity-logger.js';
import axios from 'axios';
import { getAvailablePort } from '../../test-utils.js';

describe('Web API Endpoints Real Tests', () => {
  let webServer;
  let db;
  let activityLogger;
  let port;
  let baseUrl;

  beforeEach(async () => {
    // Get available port for testing
    port = await getAvailablePort();
    baseUrl = `http://localhost:${port}`;
    
    // Setup in-memory database for testing
    db = new ConversationDB(':memory:');
    await db.initialize();
    
    // Setup activity logger with in-memory database
    activityLogger = new ActivityLogger(':memory:');
    await activityLogger.initialize();
    
    // Create and start WebServer instance
    webServer = new WebServer({
      port: port,
      db: db,
      activityLogger: activityLogger,
      verbose: false
    });
    
    await webServer.start();
    
    // Add test data
    await db.saveMessage('test-session-1', 0, 'user', 'Hello world', null, 150);
    await db.saveMessage('test-session-1', 0, 'assistant', 'Hello! How can I help you?', null, 200);
    await db.saveMessage('test-session-2', 1, 'user', 'Another session test', null, 120);
    
    await activityLogger.logEvent('user_input', 'test-session-1', 'model-123', { message: 'test input' });
    await activityLogger.logEvent('agent_response', 'test-session-1', 'model-123', { response: 'test response' });
    await activityLogger.logEvent('tool_execution_start', 'test-session-1', 'model-123', { tool: 'search' });
    await activityLogger.logEvent('tool_execution_complete', 'test-session-1', 'model-123', { tool: 'search', success: true, duration_ms: 1500 });
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

  describe('Health Check Endpoint', () => {
    test('GET /api/health should return server status', async () => {
      const response = await axios.get(`${baseUrl}/api/health`);
      
      expect(response.status).toBe(200);
      expect(response.data).toMatchObject({
        status: 'ok',
        timestamp: expect.any(String),
        connectedClients: expect.any(Number)
      });
      
      // Validate timestamp is valid ISO string
      expect(() => new Date(response.data.timestamp)).not.toThrow();
      expect(response.data.connectedClients).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Session Management Endpoints', () => {
    test('GET /api/sessions should return all sessions', async () => {
      const response = await axios.get(`${baseUrl}/api/sessions`);
      
      expect(response.status).toBe(200);
      expect(Array.isArray(response.data)).toBe(true);
    });

    test('GET /api/sessions/:sessionId/messages should return session messages', async () => {
      const response = await axios.get(`${baseUrl}/api/sessions/test-session-1/messages`);
      
      expect(response.status).toBe(200);
      expect(Array.isArray(response.data)).toBe(true);
      expect(response.data.length).toBe(2);
      
      const userMessage = response.data.find(m => m.role === 'user');
      const assistantMessage = response.data.find(m => m.role === 'assistant');
      
      expect(userMessage).toBeDefined();
      expect(userMessage.content).toBe('Hello world');
      expect(userMessage.session_id).toBe('test-session-1');
      
      expect(assistantMessage).toBeDefined();
      expect(assistantMessage.content).toBe('Hello! How can I help you?');
      expect(assistantMessage.session_id).toBe('test-session-1');
    });

    test('GET /api/sessions/:sessionId/messages should handle pagination', async () => {
      const response = await axios.get(`${baseUrl}/api/sessions/test-session-1/messages?limit=1`);
      
      expect(response.status).toBe(200);
      expect(Array.isArray(response.data)).toBe(true);
      expect(response.data.length).toBe(1);
    });

    test('GET /api/sessions/:sessionId/stats should return session statistics', async () => {
      const response = await axios.get(`${baseUrl}/api/sessions/test-session-1/stats`);
      
      expect(response.status).toBe(200);
      expect(response.data).toMatchObject({
        messageCount: expect.any(Number),
        tokenStats: expect.objectContaining({
          total_tokens: expect.any(Number),
          avg_tokens: expect.any(Number),
          max_tokens: expect.any(Number)
        })
      });
      
      expect(response.data.messageCount).toBe(2);
      expect(response.data.tokenStats.total_tokens).toBe(350); // 150 + 200
      expect(response.data.tokenStats.avg_tokens).toBe(175);
      expect(response.data.tokenStats.max_tokens).toBe(200);
    });

    test('GET /api/sessions/:sessionId/tools should return tool execution events', async () => {
      const response = await axios.get(`${baseUrl}/api/sessions/test-session-1/tools`);
      
      expect(response.status).toBe(200);
      expect(Array.isArray(response.data)).toBe(true);
      
      const toolEvents = response.data.filter(event => event.event_type.startsWith('tool_'));
      expect(toolEvents.length).toBeGreaterThanOrEqual(2); // start and complete events
    });

    test('GET /api/sessions/:sessionId/agents should return agent information', async () => {
      const response = await axios.get(`${baseUrl}/api/sessions/test-session-1/agents`);
      
      expect(response.status).toBe(200);
      expect(Array.isArray(response.data)).toBe(true);
      
      if (response.data.length > 0) {
        const agent = response.data[0];
        expect(agent).toHaveProperty('generation');
        expect(agent).toHaveProperty('messageCount');
        expect(agent).toHaveProperty('totalTokens');
        expect(agent).toHaveProperty('role');
        expect(agent).toHaveProperty('status');
      }
    });

    test('GET /api/sessions/:sessionId/analytics should return detailed analytics', async () => {
      const response = await axios.get(`${baseUrl}/api/sessions/test-session-1/analytics`);
      
      expect(response.status).toBe(200);
      expect(response.data).toMatchObject({
        sessionId: 'test-session-1',
        duration: expect.any(Number),
        conversations: expect.any(Object),
        activitySummary: expect.objectContaining({
          totalEvents: expect.any(Number),
          eventsByType: expect.any(Object),
          hourlyActivity: expect.any(Object)
        }),
        timeline: expect.objectContaining({
          start: expect.any(String),
          end: expect.any(String)
        })
      });
    });
  });

  describe('System Endpoints', () => {
    test('GET /api/system/metrics should return system metrics', async () => {
      const response = await axios.get(`${baseUrl}/api/system/metrics`);
      
      expect(response.status).toBe(200);
      expect(response.data).toMatchObject({
        uptime: expect.any(Number),
        memoryUsage: expect.any(Object),
        nodeVersion: expect.any(String),
        platform: expect.any(String),
        connectedClients: expect.any(Number),
        metrics: expect.objectContaining({
          totalEvents: expect.any(Number),
          sessionCount: expect.any(Number),
          avgEventsPerSession: expect.any(Number),
          timeRange: expect.any(String)
        })
      });
      
      expect(response.data.nodeVersion).toBe(process.version);
      expect(response.data.platform).toBe(process.platform);
    });

    test('GET /api/activity/events should return activity events', async () => {
      const response = await axios.get(`${baseUrl}/api/activity/events`);
      
      expect(response.status).toBe(200);
      expect(Array.isArray(response.data)).toBe(true);
      
      if (response.data.length > 0) {
        const event = response.data[0];
        expect(event).toHaveProperty('event_type');
        expect(event).toHaveProperty('timestamp');
        expect(event).toHaveProperty('local_session_id');
        expect(event).toHaveProperty('data');
      }
    });

    test('GET /api/activity/events should support filtering', async () => {
      const response = await axios.get(`${baseUrl}/api/activity/events?sessionId=test-session-1&limit=50`);
      
      expect(response.status).toBe(200);
      expect(Array.isArray(response.data)).toBe(true);
      
      // All events should be from the specified session
      response.data.forEach(event => {
        expect(event.local_session_id).toBe('test-session-1');
      });
    });
  });

  describe('Tool Summary Endpoint', () => {
    test('GET /api/tools/summary should return tool execution summary', async () => {
      const response = await axios.get(`${baseUrl}/api/tools/summary`);
      
      expect(response.status).toBe(200);
      expect(typeof response.data).toBe('object');
      
      // Should have tool data if tools were executed
      if (Object.keys(response.data).length > 0) {
        const toolName = Object.keys(response.data)[0];
        const toolData = response.data[toolName];
        
        expect(toolData).toHaveProperty('total');
        expect(toolData).toHaveProperty('completed');
        expect(toolData).toHaveProperty('failed');
        expect(toolData).toHaveProperty('running');
        expect(toolData).toHaveProperty('avgDuration');
      }
    });
  });

  describe('File System Endpoints', () => {
    test('GET /api/files/tree should return directory structure', async () => {
      const response = await axios.get(`${baseUrl}/api/files/tree`);
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('name');
      expect(response.data).toHaveProperty('path');
      expect(response.data).toHaveProperty('isDirectory');
    });

    test('GET /api/git/status should return git repository status', async () => {
      const response = await axios.get(`${baseUrl}/api/git/status`);
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('branch');
      expect(response.data).toHaveProperty('files');
      expect(typeof response.data.files).toBe('object');
    });

    test('POST /api/search should perform file search', async () => {
      const response = await axios.post(`${baseUrl}/api/search`, {
        query: 'test',
        type: 'files'
      });
      
      expect(response.status).toBe(200);
      expect(response.data).toMatchObject({
        query: 'test',
        type: 'files',
        results: expect.any(Array)
      });
    });
  });

  describe('Input Validation and Error Handling', () => {
    test('should reject invalid session IDs', async () => {
      const invalidSessionId = 'x'.repeat(101); // Too long
      const response = await axios.get(`${baseUrl}/api/sessions/${invalidSessionId}/messages`, {
        validateStatus: () => true
      });
      
      expect(response.status).toBe(400);
      expect(response.data).toHaveProperty('error', 'Invalid session ID');
    });

    test('should reject invalid pagination parameters', async () => {
      const response = await axios.get(`${baseUrl}/api/sessions/test-session-1/messages?limit=invalid`, {
        validateStatus: () => true
      });
      
      expect(response.status).toBe(400);
      expect(response.data).toHaveProperty('error', 'Invalid limit parameter (1-1000)');
    });

    test('should reject empty search queries', async () => {
      const response = await axios.post(`${baseUrl}/api/search`, {
        query: ''
      }, {
        validateStatus: () => true
      });
      
      expect(response.status).toBe(400);
      expect(response.data).toHaveProperty('error', 'Search query is required');
    });

    test('should handle non-existent sessions gracefully', async () => {
      const response = await axios.get(`${baseUrl}/api/sessions/non-existent-session/messages`);
      
      expect(response.status).toBe(200);
      expect(Array.isArray(response.data)).toBe(true);
      expect(response.data.length).toBe(0);
    });
  });

  describe('Database Error Scenarios', () => {
    test('should handle database unavailable scenarios', async () => {
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

    test('should handle activity logger unavailable scenarios', async () => {
      // Create server without activity logger on different port
      const loggerTestPort = await getAvailablePort();
      const serverWithoutLogger = new WebServer({ port: loggerTestPort, db: db });
      await serverWithoutLogger.start();
      
      const response = await axios.get(`http://localhost:${loggerTestPort}/api/activity/events`, {
        validateStatus: () => true
      });
      
      expect(response.status).toBe(503);
      expect(response.data).toHaveProperty('error', 'Activity logger not available');
      
      await serverWithoutLogger.stop();
    });
  });

  describe('Response Format Validation', () => {
    test('should return consistent timestamp formats', async () => {
      const response = await axios.get(`${baseUrl}/api/health`);
      
      const timestamp = response.data.timestamp;
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(() => new Date(timestamp)).not.toThrow();
    });

    test('should return proper content types', async () => {
      const response = await axios.get(`${baseUrl}/api/health`);
      
      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    test('should handle large limit parameters correctly', async () => {
      const response = await axios.get(`${baseUrl}/api/sessions/test-session-1/messages?limit=1000`);
      
      expect(response.status).toBe(200);
      expect(Array.isArray(response.data)).toBe(true);
      // Should not exceed actual available messages even with large limit
      expect(response.data.length).toBeLessThanOrEqual(2);
    });
  });
});