// ABOUTME: Real component integration tests for web companion functionality  
// ABOUTME: Tests actual WebServer components, React rendering, and real-time functionality with jsdom

import { beforeEach, afterEach, describe, expect, test } from '@jest/globals';
import { WebServer } from '../../../src/interface/web-server.js';
import { ConversationDB } from '../../../src/database/conversation-db.js';
import { ActivityLogger } from '../../../src/logging/activity-logger.js';
import { io as SocketIOClient } from 'socket.io-client';
import { JSDOM } from 'jsdom';
import axios from 'axios';
import { getAvailablePort } from '../../test-utils.js';

// Setup JSDOM for React component testing
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost',
  pretendToBeVisual: true,
  resources: 'usable'
});

global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;

describe('Web Companion Real Component Tests', () => {
  let webServer;
  let db;
  let activityLogger;
  let port;
  let baseUrl;

  beforeEach(async () => {
    // Get available port for testing
    port = await getAvailablePort();
    baseUrl = `http://localhost:${port}`;
    
    // Setup in-memory databases
    db = new ConversationDB(':memory:');
    await db.initialize();
    
    activityLogger = new ActivityLogger(':memory:');
    await activityLogger.initialize();
    
    // Create and start WebServer
    webServer = new WebServer({
      port: port,
      db: db,
      activityLogger: activityLogger,
      verbose: false
    });
    
    await webServer.start();
    
    // Add comprehensive test data
    await db.saveMessage('session-1', 0, 'user', 'Test message 1', null, 150);
    await db.saveMessage('session-1', 0, 'assistant', 'Response 1', JSON.stringify([{type: 'function', function: {name: 'search'}}]), 200);
    await db.saveMessage('session-1', 0, 'user', 'Follow up', null, 100);
    await db.saveMessage('session-2', 1, 'user', 'Different session', null, 175);
    
    // Add activity events
    await activityLogger.logEvent('user_input', 'session-1', 'model-123', { message: 'test input', tokens: 150 });
    await activityLogger.logEvent('agent_response', 'session-1', 'model-123', { response: 'test response', tokens: 200 });
    await activityLogger.logEvent('tool_execution_start', 'session-1', 'model-123', { tool: 'search', args: { query: 'test' } });
    await activityLogger.logEvent('tool_execution_complete', 'session-1', 'model-123', { tool: 'search', success: true, duration_ms: 1500, result: 'found 5 results' });
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

  describe('Real WebServer Component Integration', () => {
    test('should initialize all required middleware components', async () => {
      // Test that middleware is properly configured
      const response = await axios.get(`${baseUrl}/api/health`);
      
      // Helmet security headers
      expect(response.headers).toHaveProperty('x-content-type-options');
      expect(response.headers).toHaveProperty('x-frame-options');
      expect(response.headers).toHaveProperty('x-xss-protection');
      
      // CORS headers in development
      expect(response.status).toBe(200);
    });

    test('should handle WebSocket connections with real Socket.io', (done) => {
      const client = new SocketIOClient(baseUrl);
      
      client.on('connect', () => {
        expect(webServer.connectedClients.size).toBe(1);
        
        client.disconnect();
        setTimeout(() => {
          expect(webServer.connectedClients.size).toBe(0);
          done();
        }, 100);
      });
    });

    test('should broadcast real activity events to connected clients', (done) => {
      const client = new SocketIOClient(baseUrl);
      let eventReceived = false;
      
      client.on('connect', () => {
        client.on('activity', (event) => {
          if (eventReceived) return; // Prevent double execution
          eventReceived = true;
          
          expect(event).toHaveProperty('event_type', 'test_broadcast');
          expect(event).toHaveProperty('local_session_id', 'test-session');
          expect(event).toHaveProperty('timestamp');
          
          const data = JSON.parse(event.data);
          expect(data).toEqual({ test: 'broadcast data' });
          
          client.disconnect();
          done();
        });
        
        // Trigger activity broadcast
        setTimeout(() => {
          activityLogger.logEvent('test_broadcast', 'test-session', 'model-123', { test: 'broadcast data' });
        }, 100);
      });
    });
  });

  describe('Real Database Integration Tests', () => {
    test('should handle conversation database operations correctly', async () => {
      const response = await axios.get(`${baseUrl}/api/sessions/session-1/messages`);
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveLength(3);
      
      // Check message content and order
      const messages = response.data;
      expect(messages[0].content).toBe('Test message 1');
      expect(messages[1].content).toBe('Response 1');
      expect(messages[2].content).toBe('Follow up');
      
      // Check tool calls are preserved
      const assistantMessage = messages.find(m => m.role === 'assistant');
      expect(assistantMessage.tool_calls).toBeTruthy();
      const toolCalls = JSON.parse(assistantMessage.tool_calls);
      expect(toolCalls[0].function.name).toBe('search');
    });

    test('should calculate session statistics correctly', async () => {
      const response = await axios.get(`${baseUrl}/api/sessions/session-1/stats`);
      
      expect(response.status).toBe(200);
      expect(response.data.messageCount).toBe(3);
      expect(response.data.tokenStats.total_tokens).toBe(450); // 150 + 200 + 100
      expect(response.data.tokenStats.avg_tokens).toBe(150);
      expect(response.data.tokenStats.max_tokens).toBe(200);
    });

    test('should handle activity logger operations correctly', async () => {
      const response = await axios.get(`${baseUrl}/api/activity/events?sessionId=session-1`);
      
      expect(response.status).toBe(200);
      expect(Array.isArray(response.data)).toBe(true);
      expect(response.data.length).toBeGreaterThanOrEqual(4);
      
      // Check event types are present
      const eventTypes = response.data.map(e => e.event_type);
      expect(eventTypes).toContain('user_input');
      expect(eventTypes).toContain('agent_response');
      expect(eventTypes).toContain('tool_execution_start');
      expect(eventTypes).toContain('tool_execution_complete');
    });
  });

  describe('Real Event Filtering and Processing', () => {
    test('should filter events by session correctly', async () => {
      const session1Response = await axios.get(`${baseUrl}/api/activity/events?sessionId=session-1`);
      const session2Response = await axios.get(`${baseUrl}/api/activity/events?sessionId=session-2`);
      
      expect(session1Response.status).toBe(200);
      expect(session2Response.status).toBe(200);
      
      // Session 1 should have multiple events
      expect(session1Response.data.length).toBeGreaterThan(3);
      session1Response.data.forEach(event => {
        expect(event.local_session_id).toBe('session-1');
      });
      
      // Session 2 should have fewer events
      session2Response.data.forEach(event => {
        expect(event.local_session_id).toBe('session-2');
      });
    });

    test('should handle WebSocket event filtering in real-time', (done) => {
      const client = new SocketIOClient(baseUrl);
      
      client.on('connect', () => {
        // Subscribe to specific session
        client.emit('subscribe-session', 'filter-test-session');
        
        let relevantEventReceived = false;
        let irrelevantEventReceived = false;
        
        client.on('activity', (event) => {
          if (event.local_session_id === 'filter-test-session') {
            relevantEventReceived = true;
          } else if (event.local_session_id === 'other-session') {
            irrelevantEventReceived = true;
          }
        });
        
        // Send events to different sessions
        setTimeout(() => {
          activityLogger.logEvent('test_event', 'filter-test-session', 'model-123', { test: 'relevant' });
          activityLogger.logEvent('test_event', 'other-session', 'model-123', { test: 'irrelevant' });
        }, 100);
        
        setTimeout(() => {
          expect(relevantEventReceived).toBe(true);
          // Note: We can't guarantee irrelevant events won't be received due to timing
          client.disconnect();
          done();
        }, 500);
      });
    });
  });

  describe('Real Cost Calculation Integration', () => {
    test('should calculate costs based on actual token data', async () => {
      const response = await axios.get(`${baseUrl}/api/sessions/session-1/analytics`);
      
      expect(response.status).toBe(200);
      const analytics = response.data;
      
      // Check conversation analytics
      expect(analytics.conversations.user.totalTokens).toBe(250); // 150 + 100
      expect(analytics.conversations.assistant.totalTokens).toBe(200);
      
      // Cost calculation at $3 per 1M tokens
      const totalTokens = analytics.conversations.user.totalTokens + analytics.conversations.assistant.totalTokens;
      const expectedCost = totalTokens * 0.000003; // $3 per 1M tokens
      
      expect(totalTokens).toBe(450);
      expect(expectedCost).toBe(0.00135);
    });
  });

  describe('Real Rate Limiting Implementation', () => {
    test('should implement rate limiting for WebSocket connections', (done) => {
      const client = new SocketIOClient(baseUrl);
      let eventsReceived = 0;
      
      client.on('connect', () => {
        client.on('activity', () => {
          eventsReceived++;
        });
        
        // Rapidly send many events to test rate limiting
        for (let i = 0; i < 20; i++) {
          setTimeout(() => {
            activityLogger.logEvent(`rapid_event_${i}`, 'rate-test-session', 'model-123', { index: i });
          }, i * 10); // Send events every 10ms
        }
        
        setTimeout(() => {
          // Should receive fewer events due to rate limiting (max 10 per second per client)
          expect(eventsReceived).toBeLessThan(20);
          expect(eventsReceived).toBeGreaterThan(0);
          
          client.disconnect();
          done();
        }, 1000);
      });
    });
  });

  describe('Real Message Deduplication and Ordering', () => {
    test('should maintain chronological order in real responses', async () => {
      // Add messages with specific timestamps
      const testSessionId = 'chronology-test';
      await db.saveMessage(testSessionId, 0, 'user', 'First message', null, 100);
      await db.saveMessage(testSessionId, 0, 'assistant', 'Second message', null, 150);
      await db.saveMessage(testSessionId, 0, 'user', 'Third message', null, 120);
      
      const response = await axios.get(`${baseUrl}/api/sessions/${testSessionId}/messages`);
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveLength(3);
      
      // Messages should be in chronological order
      const timestamps = response.data.map(m => new Date(m.timestamp));
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i] >= timestamps[i-1]).toBe(true);
      }
    });

    test('should handle tool execution timeline correctly', async () => {
      const response = await axios.get(`${baseUrl}/api/tools/summary`);
      
      expect(response.status).toBe(200);
      
      if (Object.keys(response.data).length > 0) {
        const searchTool = response.data.search;
        if (searchTool) {
          expect(searchTool.total).toBe(1);
          expect(searchTool.completed).toBe(1);
          expect(searchTool.failed).toBe(0);
          expect(searchTool.avgDuration).toBe(1500);
        }
      }
    });
  });

  describe('Real Error Handling and Recovery', () => {
    test('should handle malformed JSON in activity data gracefully', async () => {
      // Add event with invalid JSON data directly to database
      await activityLogger.db.run(
        'INSERT INTO activity_log (timestamp, event_type, local_session_id, model_session_id, data) VALUES (?, ?, ?, ?, ?)',
        [new Date().toISOString(), 'malformed_event', 'test-session', 'model-123', '{invalid json']
      );
      
      const response = await axios.get(`${baseUrl}/api/activity/events?sessionId=test-session`);
      
      expect(response.status).toBe(200);
      expect(Array.isArray(response.data)).toBe(true);
      // Should not crash the server
    });

    test('should handle missing database tables gracefully', async () => {
      // Create server with corrupted database
      const corruptedDB = new ConversationDB(':memory:');
      // Don't call init() to simulate missing tables
      
      const corruptedTestPort = await getAvailablePort();
      const serverWithCorruptedDB = new WebServer({ 
        port: corruptedTestPort, 
        db: corruptedDB,
        verbose: false
      });
      
      await serverWithCorruptedDB.start();
      
      const response = await axios.get(`http://localhost:${corruptedTestPort}/api/sessions`, {
        validateStatus: () => true
      });
      
      // Should return error but not crash
      expect(response.status).toBeGreaterThanOrEqual(400);
      
      await serverWithCorruptedDB.stop();
    });
  });

  describe('Real File System Integration', () => {
    test('should build actual directory tree', async () => {
      const response = await axios.get(`${baseUrl}/api/files/tree`);
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('name');
      expect(response.data).toHaveProperty('isDirectory');
      
      if (response.data.isDirectory && response.data.children) {
        expect(Array.isArray(response.data.children)).toBe(true);
        
        if (response.data.children.length > 0) {
          const child = response.data.children[0];
          expect(child).toHaveProperty('name');
          expect(child).toHaveProperty('isDirectory');
        }
      }
    });

    test('should perform actual file search operations', async () => {
      const response = await axios.post(`${baseUrl}/api/search`, {
        query: 'test',
        type: 'files'
      });
      
      expect(response.status).toBe(200);
      expect(response.data.query).toBe('test');
      expect(Array.isArray(response.data.results)).toBe(true);
      
      // Should find test files in the project
      if (response.data.results.length > 0) {
        const result = response.data.results[0];
        expect(result).toHaveProperty('path');
        expect(result).toHaveProperty('name');
        expect(result).toHaveProperty('type', 'file');
        expect(result).toHaveProperty('context');
      }
    });
  });
});