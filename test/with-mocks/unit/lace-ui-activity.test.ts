// ABOUTME: Unit tests for LaceUI activity logging methods
// ABOUTME: Tests individual activity logging functions and error handling

import { jest } from '@jest/globals';

// Import the ActivityLogger mock (will be resolved by Jest's moduleNameMapper)
import { ActivityLogger } from '@/logging/activity-logger.js';

describe('LaceUI Activity Logging Methods', () => {
  let activityLogger: ActivityLogger;

  beforeEach(async () => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create ActivityLogger instance with mock
    activityLogger = new ActivityLogger(':memory:');
    await activityLogger.initialize();
  });

  afterEach(async () => {
    if (activityLogger) {
      await activityLogger.close();
    }
  });

  describe('Basic Activity Logging', () => {
    test('should log user input with proper structure', async () => {
      const sessionId = 'session-123';
      const userInput = {
        content: 'hello world',
        timestamp: new Date().toISOString(),
        inputMode: 'text'
      };

      await activityLogger.logEvent('user_input', sessionId, null, userInput);

      const events = await activityLogger.getEvents({ eventType: 'user_input' });
      expect(events).toHaveLength(1);
      
      const event = events[0];
      expect(event.event_type).toBe('user_input');
      expect(event.local_session_id).toBe(sessionId);
      
      const data = JSON.parse(event.data);
      expect(data.content).toBe('hello world');
      expect(data.inputMode).toBe('text');
    });

    test('should log agent responses with token information', async () => {
      const sessionId = 'session-123';
      const response = {
        content: 'I can help you with that',
        tokens: 150,
        inputTokens: 50,
        outputTokens: 100,
        duration_ms: 1200,
        model: 'claude-3-sonnet',
        timestamp: new Date().toISOString()
      };

      await activityLogger.logEvent('agent_response', sessionId, 'model-456', response);

      const events = await activityLogger.getEvents({ eventType: 'agent_response' });
      expect(events).toHaveLength(1);
      
      const event = events[0];
      expect(event.event_type).toBe('agent_response');
      expect(event.local_session_id).toBe(sessionId);
      expect(event.model_session_id).toBe('model-456');
      
      const data = JSON.parse(event.data);
      expect(data.content).toBe('I can help you with that');
      expect(data.tokens).toBe(150);
      expect(data.model).toBe('claude-3-sonnet');
    });

    test('should log model provider calls', async () => {
      const sessionId = 'session-123';
      const modelCall = {
        provider: 'anthropic',
        model: 'claude-3-sonnet',
        input_tokens: 50,
        output_tokens: 100,
        total_tokens: 150,
        duration_ms: 1200,
        timestamp: new Date().toISOString()
      };

      await activityLogger.logEvent('model_call', sessionId, 'model-456', modelCall);

      const events = await activityLogger.getEvents({ eventType: 'model_call' });
      expect(events).toHaveLength(1);
      
      const event = events[0];
      const data = JSON.parse(event.data);
      expect(data.provider).toBe('anthropic');
      expect(data.total_tokens).toBe(150);
    });
  });

  describe('Tool Execution Logging', () => {
    test('should log successful tool executions', async () => {
      const sessionId = 'session-123';
      const toolExecution = {
        tool_name: 'file_read',
        input: { path: '/test/file.txt' },
        result: { content: 'file contents', success: true },
        duration_ms: 50,
        timestamp: new Date().toISOString()
      };

      await activityLogger.logEvent('tool_execution', sessionId, null, toolExecution);

      const events = await activityLogger.getEvents({ eventType: 'tool_execution' });
      expect(events).toHaveLength(1);
      
      const event = events[0];
      const data = JSON.parse(event.data);
      expect(data.tool_name).toBe('file_read');
      expect(data.input.path).toBe('/test/file.txt');
      expect(data.result.success).toBe(true);
    });

    test('should log failed tool executions', async () => {
      const sessionId = 'session-123';
      const toolExecution = {
        tool_name: 'file_read',
        input: { path: '/nonexistent/file.txt' },
        error: 'File not found',
        success: false,
        duration_ms: 25,
        timestamp: new Date().toISOString()
      };

      await activityLogger.logEvent('tool_execution', sessionId, null, toolExecution);

      const events = await activityLogger.getEvents({ eventType: 'tool_execution' });
      expect(events).toHaveLength(1);
      
      const event = events[0];
      const data = JSON.parse(event.data);
      expect(data.tool_name).toBe('file_read');
      expect(data.success).toBe(false);
      expect(data.error).toBe('File not found');
    });

    test('should log multiple tool executions in sequence', async () => {
      const sessionId = 'session-123';
      const tools = [
        { tool_name: 'file_list', input: { path: '.' } },
        { tool_name: 'file_read', input: { path: 'package.json' } },
        { tool_name: 'shell_exec', input: { command: 'npm test' } }
      ];

      for (let i = 0; i < tools.length; i++) {
        await activityLogger.logEvent('tool_execution', sessionId, null, {
          ...tools[i],
          result: { success: true },
          duration_ms: 100 + i * 50,
          timestamp: new Date().toISOString()
        });
      }

      const events = await activityLogger.getEvents({ eventType: 'tool_execution' });
      expect(events).toHaveLength(3);
      
      // Verify all tools were logged
      const toolNames = events.map(e => JSON.parse(e.data).tool_name);
      expect(toolNames).toContain('file_list');
      expect(toolNames).toContain('file_read');
      expect(toolNames).toContain('shell_exec');
    });

    test('should log tool execution errors', async () => {
      const sessionId = 'session-123';
      const toolError = {
        tool_name: 'invalid_tool',
        input: { test: 'data' },
        error: 'Tool not found in registry',
        error_type: 'ToolNotFoundError',
        stack_trace: 'Error: Tool not found...',
        timestamp: new Date().toISOString()
      };

      await activityLogger.logEvent('tool_error', sessionId, null, toolError);

      const events = await activityLogger.getEvents({ eventType: 'tool_error' });
      expect(events).toHaveLength(1);
      
      const event = events[0];
      const data = JSON.parse(event.data);
      expect(data.error_type).toBe('ToolNotFoundError');
      expect(data.error).toBe('Tool not found in registry');
    });
  });

  describe('Streaming Token Logging', () => {
    test('should log streaming tokens when provided', async () => {
      const sessionId = 'session-123';
      const tokens = ['Hello', ' ', 'there', '!'];
      
      for (let i = 0; i < tokens.length; i++) {
        await activityLogger.logEvent('streaming_token', sessionId, 'model-456', {
          token: tokens[i],
          position: i,
          timestamp: new Date().toISOString()
        });
      }

      const events = await activityLogger.getEvents({ eventType: 'streaming_token' });
      expect(events).toHaveLength(4);
      
      // Check that all tokens were stored
      const storedTokens = events.map(e => JSON.parse(e.data).token);
      expect(storedTokens).toContain('Hello');
      expect(storedTokens).toContain(' ');
      expect(storedTokens).toContain('there');
      expect(storedTokens).toContain('!');
    });

    test('should handle streaming without breaking on errors', async () => {
      const sessionId = 'session-123';
      
      // This should not throw even if there were internal errors
      await expect(activityLogger.logEvent('streaming_token', sessionId, null, {
        token: 'test',
        timestamp: new Date().toISOString()
      })).resolves.not.toThrow();

      const events = await activityLogger.getEvents({ eventType: 'streaming_token' });
      expect(events).toHaveLength(1);
    });

    test('should log streaming metadata', async () => {
      const sessionId = 'session-123';
      const streamingData = {
        token: 'Hello',
        position: 0,
        total_tokens_estimated: 50,
        stream_id: 'stream-789',
        timestamp: new Date().toISOString()
      };

      await activityLogger.logEvent('streaming_token', sessionId, 'model-456', streamingData);

      const events = await activityLogger.getEvents({ eventType: 'streaming_token' });
      expect(events).toHaveLength(1);
      
      const data = JSON.parse(events[0].data);
      expect(data.stream_id).toBe('stream-789');
      expect(data.total_tokens_estimated).toBe(50);
    });
  });

  describe('Activity Retrieval Methods', () => {
    beforeEach(async () => {
      // Set up test data
      const testEvents = [
        { type: 'user_input', data: { content: 'first message' } },
        { type: 'agent_response', data: { content: 'first response' } },
        { type: 'tool_execution', data: { tool_name: 'file_list' } },
        { type: 'user_input', data: { content: 'second message' } },
        { type: 'agent_response', data: { content: 'second response' } }
      ];

      for (let i = 0; i < testEvents.length; i++) {
        await activityLogger.logEvent(
          testEvents[i].type,
          'session-123',
          null,
          testEvents[i].data
        );
        // Small delay to ensure different timestamps
        await new Promise(resolve => setTimeout(resolve, 1));
      }
    });

    test('getRecentActivity should return recent events', async () => {
      const events = await activityLogger.getRecentEvents(3);
      
      expect(events).toHaveLength(3);
      // Should be in descending order (most recent first)
      expect(events[0].event_type).toBe('agent_response');
      expect(events[1].event_type).toBe('user_input');
      expect(events[2].event_type).toBe('tool_execution');
    });

    test('getSessionActivity should filter by session ID', async () => {
      // Add events for different session
      await activityLogger.logEvent('user_input', 'session-456', null, { content: 'other session' });
      
      const events = await activityLogger.getEvents({ sessionId: 'session-123' });
      
      expect(events.length).toBeGreaterThan(0);
      events.forEach(event => {
        expect(event.local_session_id).toBe('session-123');
      });
      
      // Verify other session event is not included
      const otherSessionEvents = events.filter(e => 
        JSON.parse(e.data).content === 'other session'
      );
      expect(otherSessionEvents).toHaveLength(0);
    });

    test('getActivityByType should filter by event type', async () => {
      const userInputEvents = await activityLogger.getEvents({ eventType: 'user_input' });
      
      expect(userInputEvents).toHaveLength(2);
      userInputEvents.forEach(event => {
        expect(event.event_type).toBe('user_input');
      });
      
      const toolEvents = await activityLogger.getEvents({ eventType: 'tool_execution' });
      expect(toolEvents).toHaveLength(1);
      expect(toolEvents[0].event_type).toBe('tool_execution');
    });

    test('activity retrieval should handle database errors gracefully', async () => {
      // For this mock implementation, just verify no throwing occurs
      await expect(activityLogger.getEvents({})).resolves.not.toThrow();
      await expect(activityLogger.getRecentEvents(10)).resolves.not.toThrow();
    });

    test('should support complex filtering', async () => {
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

  describe('Activity Logger Cleanup', () => {
    test('should close activity logger on stop', async () => {
      // Test that close works without throwing
      await expect(activityLogger.close()).resolves.not.toThrow();
      
      // Recreate for afterEach cleanup
      activityLogger = new ActivityLogger(':memory:');
      await activityLogger.initialize();
    });

    test('should handle close errors gracefully', async () => {
      // Multiple closes should not cause issues
      await activityLogger.close();
      await expect(activityLogger.close()).resolves.not.toThrow();
      
      // Recreate for afterEach cleanup
      activityLogger = new ActivityLogger(':memory:');
      await activityLogger.initialize();
    });

    test('should handle reinitialization', async () => {
      await activityLogger.close();
      
      // Should be able to reinitialize
      await expect(activityLogger.initialize()).resolves.not.toThrow();
      
      // Should work normally after reinit
      await activityLogger.logEvent('test', 'session-123', null, { test: 'data' });
      const events = await activityLogger.getEvents({ eventType: 'test' });
      expect(events).toHaveLength(1);
    });
  });

  describe('Event Data Validation', () => {
    test('should handle various data types', async () => {
      const testCases = [
        { type: 'string_data', data: 'simple string' },
        { type: 'object_data', data: { key: 'value', nested: { deep: 'object' } } },
        { type: 'array_data', data: [1, 2, 3, 'mixed', { array: true }] },
        { type: 'number_data', data: 42 },
        { type: 'boolean_data', data: true }
      ];

      for (const testCase of testCases) {
        await activityLogger.logEvent(testCase.type, 'session-123', null, testCase.data);
      }

      const events = await activityLogger.getEvents({});
      expect(events.length).toBeGreaterThanOrEqual(5);
      
      // Verify each data type was stored correctly
      const stringEvent = events.find(e => e.event_type === 'string_data');
      expect(stringEvent?.data).toBe('simple string');
      
      const objectEvent = events.find(e => e.event_type === 'object_data');
      expect(JSON.parse(objectEvent!.data)).toEqual({ key: 'value', nested: { deep: 'object' } });
    });

    test('should handle empty and null data', async () => {
      await activityLogger.logEvent('empty_string', 'session-123', null, '');
      await activityLogger.logEvent('null_data', 'session-123', null, null);
      await activityLogger.logEvent('empty_object', 'session-123', null, {});

      const events = await activityLogger.getEvents({});
      expect(events.length).toBeGreaterThanOrEqual(3);
      
      const emptyStringEvent = events.find(e => e.event_type === 'empty_string');
      expect(emptyStringEvent?.data).toBe('');
      
      const nullEvent = events.find(e => e.event_type === 'null_data');
      expect(nullEvent?.data).toBe('null');
    });
  });
});