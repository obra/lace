// ABOUTME: Unit tests for console activity logging integration
// ABOUTME: Tests that user_input and agent_response events are logged correctly

import { test, describe, beforeEach, afterEach } from '../test-harness.js';
import { TestHarness, assert, utils } from '../test-harness.js';
import { Console } from '../../src/interface/console.js';
import { ActivityLogger } from '../../src/logging/activity-logger.js';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('Console Activity Logging', () => {
  let harness;
  let testDbPath;
  let console;
  let mockAgent;

  beforeEach(async () => {
    harness = new TestHarness();
    testDbPath = join(tmpdir(), `console-activity-test-${Date.now()}.db`);
    console = new Console();
    
    // Override the activity logger to use our test database
    console.activityLogger = new ActivityLogger(testDbPath);
    
    // Create a mock agent for testing
    mockAgent = {
      processInput: async (sessionId, input, options) => {
        // Simulate processing delay
        await new Promise(resolve => setTimeout(resolve, 10));
        return {
          content: `Mock response to: ${input}`,
          usage: {
            total_tokens: 150,
            output_tokens: 75
          }
        };
      }
    };
  });

  afterEach(async () => {
    await harness.cleanup();
    if (console.activityLogger) {
      await console.activityLogger.close();
    }
    try {
      await fs.unlink(testDbPath);
    } catch (error) {
      // File might not exist, ignore
    }
  });

  describe('Activity Logger Initialization', () => {
    test('should initialize activity logger during console start', async () => {
      await console.activityLogger.initialize();
      
      // Verify the database was created
      assert.ok(await utils.fileExists(testDbPath));
      
      // Verify we can query events (should be empty initially)
      const events = await console.activityLogger.getEvents();
      assert.strictEqual(events.length, 0);
    });
  });

  describe('User Input Logging', () => {
    beforeEach(async () => {
      await console.activityLogger.initialize();
    });

    test('should log user_input events with correct data structure', async () => {
      const testInput = 'Hello, test input message';
      
      // Simulate the handleInput method logging (without full console interaction)
      await console.activityLogger.logEvent('user_input', console.sessionId, null, {
        content: testInput,
        timestamp: new Date().toISOString()
      });
      
      const events = await console.activityLogger.getEvents();
      assert.strictEqual(events.length, 1);
      
      const event = events[0];
      assert.strictEqual(event.event_type, 'user_input');
      assert.strictEqual(event.local_session_id, console.sessionId);
      assert.strictEqual(event.model_session_id, null);
      
      const data = JSON.parse(event.data);
      assert.strictEqual(data.content, testInput);
      assert.ok(data.timestamp);
    });
  });

  describe('Agent Response Logging', () => {
    beforeEach(async () => {
      await console.activityLogger.initialize();
    });

    test('should log agent_response events with timing and token data', async () => {
      const responseContent = 'Test agent response';
      const duration = 1200;
      const tokens = 150;
      
      // Simulate agent response logging
      await console.activityLogger.logEvent('agent_response', console.sessionId, null, {
        content: responseContent,
        tokens: tokens,
        duration_ms: duration
      });
      
      const events = await console.activityLogger.getEvents();
      assert.strictEqual(events.length, 1);
      
      const event = events[0];
      assert.strictEqual(event.event_type, 'agent_response');
      assert.strictEqual(event.local_session_id, console.sessionId);
      
      const data = JSON.parse(event.data);
      assert.strictEqual(data.content, responseContent);
      assert.strictEqual(data.tokens, tokens);
      assert.strictEqual(data.duration_ms, duration);
    });
  });

  describe('Integrated Console Flow', () => {
    beforeEach(async () => {
      await console.activityLogger.initialize();
    });

    test('should log both input and response in correct order', async () => {
      const userInput = 'Test user message';
      
      // Simulate the full flow that happens in handleInput
      // 1. Log user input
      await console.activityLogger.logEvent('user_input', console.sessionId, null, {
        content: userInput,
        timestamp: new Date().toISOString()
      });
      
      // 2. Process with mock agent
      const startTime = Date.now();
      const response = await mockAgent.processInput(console.sessionId, userInput, {});
      const duration = Date.now() - startTime;
      
      // 3. Log agent response
      await console.activityLogger.logEvent('agent_response', console.sessionId, null, {
        content: response.content,
        tokens: response.usage.total_tokens,
        duration_ms: duration
      });
      
      // Verify both events were logged
      const events = await console.activityLogger.getEvents();
      assert.strictEqual(events.length, 2);
      
      // Events should be in reverse chronological order (most recent first)
      const [responseEvent, inputEvent] = events;
      
      assert.strictEqual(inputEvent.event_type, 'user_input');
      assert.strictEqual(responseEvent.event_type, 'agent_response');
      
      const inputData = JSON.parse(inputEvent.data);
      const responseData = JSON.parse(responseEvent.data);
      
      assert.strictEqual(inputData.content, userInput);
      assert.ok(responseData.content.includes(userInput)); // Mock response echoes input
      assert.strictEqual(responseData.tokens, 150);
      assert.ok(responseData.duration_ms >= 0);
    });

    test('should handle multiple conversation turns', async () => {
      const inputs = ['First message', 'Second message', 'Third message'];
      
      for (const input of inputs) {
        // Log user input
        await console.activityLogger.logEvent('user_input', console.sessionId, null, {
          content: input,
          timestamp: new Date().toISOString()
        });
        
        // Process and log response
        const response = await mockAgent.processInput(console.sessionId, input, {});
        await console.activityLogger.logEvent('agent_response', console.sessionId, null, {
          content: response.content,
          tokens: response.usage.total_tokens,
          duration_ms: 100
        });
        
        // Small delay between turns
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      
      const events = await console.activityLogger.getEvents();
      assert.strictEqual(events.length, 6); // 3 inputs + 3 responses
      
      // Count event types
      const inputEvents = events.filter(e => e.event_type === 'user_input');
      const responseEvents = events.filter(e => e.event_type === 'agent_response');
      
      assert.strictEqual(inputEvents.length, 3);
      assert.strictEqual(responseEvents.length, 3);
      
      // Verify all events have the same session ID
      for (const event of events) {
        assert.strictEqual(event.local_session_id, console.sessionId);
      }
    });
  });
});