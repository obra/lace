// ABOUTME: Unit tests for web companion functionality including conversation views and real-time streaming
// ABOUTME: Tests WebSocket connections, API endpoints, activity streaming, and conversation display

import { describe, test, beforeEach, afterEach, expect, jest } from '@jest/globals';
import request from 'supertest';
import { io as Client } from 'socket.io-client';
import { WebServer } from '../../src/interface/web-server.js';
import { ActivityLogger } from '../../src/logging/activity-logger.js';
import { ConversationDB } from '../../src/database/conversation-db.js';
import { promises as fs } from 'fs';

// Test utility functions
const createTestDatabase = async (suffix = '') => {
  const dbPath = `./test-db-${Date.now()}${suffix}.db`;
  return dbPath;
};

const cleanupFile = async (filePath) => {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    // Ignore if file doesn't exist
  }
};

describe('Web Companion Tests', () => {
  let webServer;
  let activityLogger;
  let db;
  let testPort;
  let dbPath;
  let activityDbPath;

  beforeEach(async () => {
    testPort = 3001 + Math.floor(Math.random() * 1000); // Random port to avoid conflicts
    
    // Create test database and activity logger
    dbPath = await createTestDatabase('-conversation');
    activityDbPath = await createTestDatabase('-activity');
    
    db = new ConversationDB(dbPath);
    await db.initialize();
    
    activityLogger = new ActivityLogger(activityDbPath);
    await activityLogger.initialize();
    
    // Create web server
    webServer = new WebServer({
      port: testPort,
      activityLogger: activityLogger,
      db: db,
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
    
    // Cleanup test files
    await cleanupFile(dbPath);
    await cleanupFile(activityDbPath);
  });

  describe('WebServer Initialization', () => {
    test('should initialize with correct configuration', () => {
      expect(webServer.port).toBe(testPort);
      expect(webServer.activityLogger).toBe(activityLogger);
      expect(webServer.db).toBe(db);
      expect(webServer.isStarted).toBe(false);
    });

    test('should start and stop gracefully', async () => {
      await webServer.start();
      expect(webServer.isStarted).toBe(true);
      
      const status = webServer.getStatus();
      expect(status.isStarted).toBe(true);
      expect(status.port).toBe(testPort);
      expect(status.connectedClients).toBe(0);
      
      await webServer.stop();
      expect(webServer.isStarted).toBe(false);
    });
  });

  describe('API Endpoints', () => {
    beforeEach(async () => {
      await webServer.start();
    });

    test('should respond to health check', async () => {
      const response = await request(webServer.app)
        .get('/api/health')
        .expect(200);
      
      expect(response.body.status).toBe('ok');
      expect(response.body.timestamp).toBeDefined();
      expect(response.body.connectedClients).toBe(0);
    });

    test('should return sessions list', async () => {
      // Add a test session
      await db.run(`
        INSERT INTO sessions (id, created_at, last_active, current_generation)
        VALUES (?, ?, ?, ?)
      `, ['test-session-1', '2024-01-01T10:00:00Z', '2024-01-01T11:00:00Z', 0]);

      const response = await request(webServer.app)
        .get('/api/sessions')
        .expect(200);
      
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].id).toBe('test-session-1');
    });

    test('should return conversation messages for session', async () => {
      const sessionId = 'test-session-messages';
      
      // Add test messages
      await db.saveMessage(sessionId, 0, 'user', 'Hello there', null, 50);
      await db.saveMessage(sessionId, 0, 'assistant', 'Hello! How can I help?', null, 120);
      
      const response = await request(webServer.app)
        .get(`/api/sessions/${sessionId}/messages`)
        .expect(200);
      
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].role).toBe('user');
      expect(response.body[1].role).toBe('assistant');
    });

    test('should return session statistics', async () => {
      const sessionId = 'test-session-stats';
      
      // Add test messages with context sizes
      await db.saveMessage(sessionId, 0, 'user', 'Test message 1', null, 100);
      await db.saveMessage(sessionId, 0, 'assistant', 'Test response 1', null, 200);
      await db.saveMessage(sessionId, 0, 'user', 'Test message 2', null, 150);
      
      const response = await request(webServer.app)
        .get(`/api/sessions/${sessionId}/stats`)
        .expect(200);
      
      expect(response.body.messageCount).toBe(3);
      expect(response.body.tokenStats.total_tokens).toBe(450);
      expect(response.body.tokenStats.avg_tokens).toBe(150);
      expect(response.body.tokenStats.max_tokens).toBe(200);
    });
  });

  describe('Real-time Activity Streaming', () => {
    let client;

    beforeEach(async () => {
      await webServer.start();
    });

    afterEach(() => {
      if (client) {
        client.disconnect();
      }
    });

    test('should accept WebSocket connections', (done) => {
      client = Client(`http://localhost:${testPort}`);
      
      client.on('connect', () => {
        expect(webServer.connectedClients.size).toBe(1);
        done();
      });
      
      client.on('connect_error', done);
    });

    test('should stream activity events in real-time', (done) => {
      client = Client(`http://localhost:${testPort}`);
      
      client.on('connect', () => {
        client.on('activity', (event) => {
          expect(event.event_type).toBe('test_event');
          expect(event.local_session_id).toBe('test-session');
          expect(event.timestamp).toBeDefined();
          done();
        });
        
        setTimeout(() => {
          activityLogger.logEvent('test_event', 'test-session', null, { test: 'data' });
        }, 50);
      });
    });

    test('should support event filtering', (done) => {
      client = Client(`http://localhost:${testPort}`);
      let receivedEvents = [];
      
      client.on('connect', () => {
        client.emit('filter-activity', { eventType: 'user_input' });
        
        client.on('activity', (event) => {
          receivedEvents.push(event);
        });
        
        setTimeout(() => {
          activityLogger.logEvent('user_input', 'test-session', null, { message: 'hello' });
          activityLogger.logEvent('agent_response', 'test-session', null, { response: 'hi' });
          activityLogger.logEvent('user_input', 'test-session', null, { message: 'how are you?' });
        }, 50);
        
        setTimeout(() => {
          expect(receivedEvents.length).toBe(2);
          expect(receivedEvents.every(e => e.event_type === 'user_input')).toBe(true);
          done();
        }, 200);
      });
    });
  });

  describe('Activity Event Processing', () => {
    test('should emit events when logging activity', (done) => {
      let eventReceived = false;
      
      activityLogger.on('activity', (event) => {
        expect(event.event_type).toBe('conversation_message');
        expect(event.local_session_id).toBe('test-session');
        expect(event.timestamp).toBeDefined();
        eventReceived = true;
      });
      
      activityLogger.logEvent('conversation_message', 'test-session', 'model-123', {
        role: 'user',
        content: 'Test message'
      });
      
      setTimeout(() => {
        expect(eventReceived).toBe(true);
        done();
      }, 100);
    });

    test('should provide recent events for backfill', async () => {
      await activityLogger.logEvent('event_1', 'session-1', null, { data: 1 });
      await activityLogger.logEvent('event_2', 'session-1', null, { data: 2 });
      await activityLogger.logEvent('event_3', 'session-2', null, { data: 3 });
      
      const recentEvents = await activityLogger.getRecentEvents(10);
      
      expect(Array.isArray(recentEvents)).toBe(true);
      expect(recentEvents).toHaveLength(3);
      expect(recentEvents[0].event_type).toBe('event_3'); // Newest first
    });
  });

  describe('Error Handling', () => {
    test('should handle database unavailable gracefully', async () => {
      const serverWithoutDb = new WebServer({
        port: testPort + 1,
        activityLogger: activityLogger,
        db: null,
        verbose: false
      });
      
      await serverWithoutDb.start();
      
      const response = await request(serverWithoutDb.app)
        .get('/api/sessions')
        .expect(503);
      
      expect(response.body.error).toBe('Database not available');
      
      await serverWithoutDb.stop();
    });

    test('should handle nonexistent session requests gracefully', async () => {
      await webServer.start();
      
      const response = await request(webServer.app)
        .get('/api/sessions/nonexistent/messages')
        .expect(200);
      
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(0);
    });
  });

  describe('Rate Limiting', () => {
    let client;

    beforeEach(async () => {
      await webServer.start();
    });

    afterEach(() => {
      if (client) {
        client.disconnect();
      }
    });

    test('should rate limit high-frequency events', (done) => {
      client = Client(`http://localhost:${testPort}`);
      let receivedCount = 0;
      
      client.on('connect', () => {
        client.on('activity', () => {
          receivedCount++;
        });
        
        // Send many events rapidly
        for (let i = 0; i < 20; i++) {
          setTimeout(() => {
            activityLogger.logEvent('rapid_event', 'test-session', null, { count: i });
          }, i * 5); // 5ms intervals = very rapid
        }
        
        setTimeout(() => {
          expect(receivedCount).toBeLessThan(20);
          expect(receivedCount).toBeGreaterThan(0);
          done();
        }, 500);
      });
    });
  });
});