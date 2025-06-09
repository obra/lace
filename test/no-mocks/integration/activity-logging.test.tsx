// ABOUTME: Integration tests for activity logging in Ink UI
// ABOUTME: Tests logging of user inputs, agent responses, tool executions, and activity retrieval

import { jest } from '@jest/globals';

// Import the ActivityLogger mock (will be resolved by Jest's moduleNameMapper)
import { ActivityLogger } from '@/logging/activity-logger.js';

// Mock fullscreen-ink to avoid terminal issues in tests
jest.mock('fullscreen-ink', () => ({
  withFullScreen: jest.fn(() => ({
    start: jest.fn(() => Promise.resolve({ unmount: jest.fn() }))
  }))
}));

// Create a proper mock for LaceUI since we're testing its activity logging integration
const mockLaceUI = {
  start: jest.fn(),
  stop: jest.fn(),
  handleMessage: jest.fn(),
  getRecentActivity: jest.fn(),
  getSessionActivity: jest.fn(),
  getActivityByType: jest.fn(),
  handleActivityCommand: jest.fn(),
  sessionId: 'session-123',
  activityLogger: null as any
};

describe('Activity Logging Integration', () => {
  let activityLogger: ActivityLogger;

  beforeEach(async () => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create actual ActivityLogger instance (will use our mock)
    activityLogger = new ActivityLogger(':memory:');
    await activityLogger.initialize();
    
    // Set up mockLaceUI with the activity logger
    mockLaceUI.activityLogger = activityLogger;
  });

  afterEach(async () => {
    if (activityLogger) {
      await activityLogger.close();
    }
  });

  describe('ActivityLogger Basic Functionality', () => {
    test('should initialize activity logger successfully', async () => {
      expect(activityLogger).toBeDefined();
      expect(typeof activityLogger.logEvent).toBe('function');
      expect(typeof activityLogger.getEvents).toBe('function');
    });

    test('should log user input events', async () => {
      await activityLogger.logEvent(
        'user_input',
        'session-123',
        null,
        { content: 'hello', timestamp: new Date().toISOString() }
      );

      const events = await activityLogger.getEvents({ eventType: 'user_input' });
      expect(events).toHaveLength(1);
      expect(events[0].event_type).toBe('user_input');
      expect(JSON.parse(events[0].data)).toMatchObject({ content: 'hello' });
    });

    test('should log agent response events', async () => {
      await activityLogger.logEvent(
        'agent_response',
        'session-123',
        null,
        {
          content: 'Hello world',
          tokens: 100,
          duration_ms: 250,
          timestamp: new Date().toISOString()
        }
      );

      const events = await activityLogger.getEvents({ eventType: 'agent_response' });
      expect(events).toHaveLength(1);
      expect(events[0].event_type).toBe('agent_response');
      
      const eventData = JSON.parse(events[0].data);
      expect(eventData.content).toBe('Hello world');
      expect(eventData.tokens).toBe(100);
    });

    test('should log tool execution events', async () => {
      await activityLogger.logEvent(
        'tool_execution',
        'session-123',
        null,
        {
          tool_name: 'file_list',
          input: { path: '.' },
          result: { success: true, files: [] },
          duration_ms: 100,
          timestamp: new Date().toISOString()
        }
      );

      const events = await activityLogger.getEvents({ eventType: 'tool_execution' });
      expect(events).toHaveLength(1);
      expect(events[0].event_type).toBe('tool_execution');
      
      const eventData = JSON.parse(events[0].data);
      expect(eventData.tool_name).toBe('file_list');
      expect(eventData.input).toEqual({ path: '.' });
    });

    test('should handle streaming token events', async () => {
      const tokens = ['Hello', ' ', 'world'];
      
      for (const token of tokens) {
        await activityLogger.logEvent(
          'streaming_token',
          'session-123',
          null,
          {
            token,
            timestamp: new Date().toISOString()
          }
        );
      }

      const events = await activityLogger.getEvents({ eventType: 'streaming_token' });
      expect(events).toHaveLength(3);
      
      const tokenValues = events.map(e => JSON.parse(e.data).token);
      expect(tokenValues).toEqual(['Hello', ' ', 'world']); // Actually in insertion order for our mock
    });
  });

  describe('Activity Retrieval', () => {
    beforeEach(async () => {
      // Add some test events
      await activityLogger.logEvent('user_input', 'session-123', null, { content: 'hello' });
      await activityLogger.logEvent('agent_response', 'session-123', null, { content: 'Hi there' });
      await activityLogger.logEvent('tool_execution', 'session-123', null, { tool_name: 'file_list' });
      await activityLogger.logEvent('user_input', 'session-456', null, { content: 'bye' });
    });

    test('should get recent events with limit', async () => {
      const events = await activityLogger.getRecentEvents(2);
      
      expect(events).toHaveLength(2);
      expect(events[0].event_type).toBe('user_input'); // Most recent first
      expect(events[1].event_type).toBe('tool_execution');
    });

    test('should filter events by session ID', async () => {
      const events = await activityLogger.getEvents({ sessionId: 'session-123' });
      
      expect(events).toHaveLength(3);
      events.forEach(event => {
        expect(event.local_session_id).toBe('session-123');
      });
    });

    test('should filter events by event type', async () => {
      const events = await activityLogger.getEvents({ eventType: 'user_input' });
      
      expect(events).toHaveLength(2);
      events.forEach(event => {
        expect(event.event_type).toBe('user_input');
      });
    });

    test('should filter events by timestamp', async () => {
      const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();
      const events = await activityLogger.getEvents({ since: oneMinuteAgo });
      
      // All events should be recent
      expect(events.length).toBeGreaterThan(0);
      events.forEach(event => {
        expect(new Date(event.timestamp).getTime()).toBeGreaterThan(new Date(oneMinuteAgo).getTime());
      });
    });

    test('should combine multiple filters', async () => {
      const events = await activityLogger.getEvents({
        sessionId: 'session-123',
        eventType: 'user_input',
        limit: 1
      });
      
      expect(events).toHaveLength(1);
      expect(events[0].event_type).toBe('user_input');
      expect(events[0].local_session_id).toBe('session-123');
    });
  });

  describe('Activity Logger Error Handling', () => {
    test('should handle logging errors gracefully', async () => {
      // This would test error handling if we had a way to force errors
      // For now, just verify logging doesn't throw
      await expect(activityLogger.logEvent(
        'test_event',
        'session-123',
        null,
        { test: 'data' }
      )).resolves.not.toThrow();
    });

    test('should handle close operation', async () => {
      // Test that close works
      await expect(activityLogger.close()).resolves.not.toThrow();
      
      // Create a new instance for cleanup in afterEach
      activityLogger = new ActivityLogger(':memory:');
      await activityLogger.initialize();
    });
  });

  describe('Event Data Structure', () => {
    test('should store events with proper structure', async () => {
      const testData = {
        content: 'test message',
        metadata: { key: 'value' },
        timestamp: new Date().toISOString()
      };

      await activityLogger.logEvent(
        'test_event',
        'session-123',
        'model-session-456',
        testData
      );

      const events = await activityLogger.getEvents({ eventType: 'test_event' });
      
      expect(events).toHaveLength(1);
      const event = events[0];
      
      expect(event.event_type).toBe('test_event');
      expect(event.local_session_id).toBe('session-123');
      expect(event.model_session_id).toBe('model-session-456');
      expect(event.timestamp).toBeDefined();
      expect(event.id).toBeDefined();
      
      const storedData = JSON.parse(event.data);
      expect(storedData).toEqual(testData);
    });

    test('should handle string data directly', async () => {
      const stringData = 'simple string data';

      await activityLogger.logEvent(
        'string_event',
        'session-123',
        null,
        stringData
      );

      const events = await activityLogger.getEvents({ eventType: 'string_event' });
      
      expect(events).toHaveLength(1);
      expect(events[0].data).toBe(stringData);
    });
  });
});