// ABOUTME: Unit tests for activity logger functionality  
// ABOUTME: Tests database setup, event logging, and query capabilities

import { test, describe, beforeEach, afterEach } from '../test-harness.js';
import { TestHarness, assert, utils } from '../test-harness.js';
import { ActivityLogger } from '../../src/logging/activity-logger.js';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('ActivityLogger', () => {
  let harness;
  let testDbPath;
  let logger;

  beforeEach(async () => {
    harness = new TestHarness();
    testDbPath = join(tmpdir(), `activity-test-${Date.now()}.db`);
    logger = new ActivityLogger(testDbPath);
  });

  afterEach(async () => {
    await harness.cleanup();
    if (logger) {
      await logger.close();
    }
    try {
      await fs.unlink(testDbPath);
    } catch (error) {
      // File might not exist, ignore
    }
  });

  describe('Database Initialization', () => {
    test('should initialize database and create tables', async () => {
      await logger.initialize();
      
      // Check that the database file was created
      assert.ok(await utils.fileExists(testDbPath));
      
      // Check that the events table exists by querying it
      const events = await logger.getEvents();
      assert.ok(Array.isArray(events));
      assert.strictEqual(events.length, 0);
    });

    test('should create .lace directory if it does not exist', async () => {
      const nestedPath = join(tmpdir(), 'test-lace-dir', 'activity.db');
      const nestedLogger = new ActivityLogger(nestedPath);
      
      await nestedLogger.initialize();
      
      assert.ok(await utils.fileExists(nestedPath));
      
      await nestedLogger.close();
      await fs.unlink(nestedPath);
      await fs.rmdir(join(tmpdir(), 'test-lace-dir'));
    });
  });

  describe('Event Logging', () => {
    beforeEach(async () => {
      await logger.initialize();
    });

    test('should log events with all required fields', async () => {
      const eventData = { message: 'test event', details: 'some details' };
      
      await logger.logEvent('test_event', 'session-123', 'model-456', eventData);
      
      const events = await logger.getEvents();
      assert.strictEqual(events.length, 1);
      
      const event = events[0];
      assert.strictEqual(event.event_type, 'test_event');
      assert.strictEqual(event.local_session_id, 'session-123');
      assert.strictEqual(event.model_session_id, 'model-456');
      assert.ok(event.timestamp);
      
      const parsedData = JSON.parse(event.data);
      assert.strictEqual(parsedData.message, 'test event');
      assert.strictEqual(parsedData.details, 'some details');
    });

    test('should handle string data directly', async () => {
      await logger.logEvent('test_event', 'session-123', null, 'simple string data');
      
      const events = await logger.getEvents();
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].data, 'simple string data');
    });

    test('should handle null model session id', async () => {
      await logger.logEvent('test_event', 'session-123', null, { data: 'test' });
      
      const events = await logger.getEvents();
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].model_session_id, null);
    });

    test('should not throw on logging errors', async () => {
      // Close the database to simulate an error
      await logger.close();
      
      // Clear any previous calls to console.error
      console.error.mockClear();
      
      // This should not throw, just log an error
      await logger.logEvent('test_event', 'session-123', null, { data: 'test' });
      
      // Verify error was logged
      expect(console.error).toHaveBeenCalledWith('ActivityLogger: Database not initialized');
    });
  });

  describe('Event Querying', () => {
    beforeEach(async () => {
      await logger.initialize();
      
      // Add some test events
      await logger.logEvent('user_input', 'session-1', 'model-1', { content: 'Hello' });
      await logger.logEvent('agent_response', 'session-1', 'model-1', { content: 'Hi there' });
      await logger.logEvent('user_input', 'session-2', 'model-2', { content: 'Goodbye' });
      
      // Wait a moment to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));
      await logger.logEvent('tool_execution', 'session-1', 'model-1', { tool: 'file-tool' });
    });

    test('should get all events in descending timestamp order', async () => {
      const events = await logger.getEvents();
      assert.strictEqual(events.length, 4);
      
      // Should be in descending timestamp order (most recent first)
      assert.strictEqual(events[0].event_type, 'tool_execution');
      assert.strictEqual(events[3].event_type, 'user_input');
    });

    test('should filter by session id', async () => {
      const events = await logger.getEvents({ sessionId: 'session-1' });
      assert.strictEqual(events.length, 3);
      
      for (const event of events) {
        assert.strictEqual(event.local_session_id, 'session-1');
      }
    });

    test('should filter by event type', async () => {
      const events = await logger.getEvents({ eventType: 'user_input' });
      assert.strictEqual(events.length, 2);
      
      for (const event of events) {
        assert.strictEqual(event.event_type, 'user_input');
      }
    });

    test('should limit results', async () => {
      const events = await logger.getEvents({ limit: 2 });
      assert.strictEqual(events.length, 2);
    });

    test('should combine filters', async () => {
      const events = await logger.getEvents({ 
        sessionId: 'session-1', 
        eventType: 'user_input',
        limit: 1 
      });
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].local_session_id, 'session-1');
      assert.strictEqual(events[0].event_type, 'user_input');
    });

    test('should filter by timestamp', async () => {
      // Wait a moment to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));
      const now = new Date().toISOString();
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Add a new event after getting the timestamp
      await logger.logEvent('new_event', 'session-3', null, { data: 'recent' });
      
      const events = await logger.getEvents({ since: now });
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].event_type, 'new_event');
    });
  });

  describe('Database Management', () => {
    test('should close database connection', async () => {
      await logger.initialize();
      await logger.close();
      
      // After closing, getEvents should throw
      try {
        await logger.getEvents();
        assert.fail('Should have thrown after closing database');
      } catch (error) {
        assert.ok(error.message.includes('Database not initialized'));
      }
    });

    test('should handle multiple close calls gracefully', async () => {
      await logger.initialize();
      await logger.close();
      await logger.close(); // Should not throw
    });
  });
});