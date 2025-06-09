// ABOUTME: Unit tests for LaceUI activity logging methods
// ABOUTME: Tests individual activity logging functions and error handling

import { jest } from '@jest/globals';
import { LaceUI } from '../../../src/ui/lace-ui.js';
import { ActivityLogger } from '../../../src/logging/activity-logger.js';

// Mock all dependencies
jest.mock('../../../src/logging/activity-logger.js');
// Mock backend dependencies with simple implementations
jest.mock('../../../src/database/conversation-db.js');
jest.mock('../../../src/tools/tool-registry.js');
jest.mock('../../../src/models/model-provider.js');
jest.mock('../../../src/agents/agent.js');

const MockActivityLogger = ActivityLogger as jest.MockedClass<typeof ActivityLogger>;

describe('LaceUI Activity Logging Methods', () => {
  let laceUI: LaceUI;
  let mockActivityLogger: jest.Mocked<ActivityLogger>;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create simple mock for ActivityLogger
    mockActivityLogger = {
      initialize: jest.fn(),
      logEvent: jest.fn(),
      getEvents: jest.fn(),
      getRecentEvents: jest.fn(),
      close: jest.fn(),
    } as any;

    MockActivityLogger.mockImplementation(() => mockActivityLogger);
    
    laceUI = new LaceUI({
      verbose: false,
      memoryPath: ':memory:',
      activityLogPath: '.lace/test-activity.db'
    });
  });

  describe('Activity Logger Initialization', () => {
    test('should initialize activity logger with default path', async () => {
      const defaultLaceUI = new LaceUI();
      await defaultLaceUI.start();
      
      expect(MockActivityLogger).toHaveBeenCalledWith('.lace/activity.db');
      expect(mockActivityLogger.initialize).toHaveBeenCalled();
    });

    test('should initialize activity logger with custom path', async () => {
      await laceUI.start();
      
      expect(MockActivityLogger).toHaveBeenCalledWith('.lace/test-activity.db');
      expect(mockActivityLogger.initialize).toHaveBeenCalled();
    });

    test('should handle activity logger initialization failure', async () => {
      mockActivityLogger.initialize.mockRejectedValue(new Error('Init failed'));
      
      // Should not throw, but log error
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      await laceUI.start();
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'ActivityLogger initialization failed:',
        expect.any(Error)
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe('User Input Logging', () => {
    test('should log user input with session ID and timestamp', async () => {
      await laceUI.start();
      
      const input = 'Hello, how are you?';
      const startTime = Date.now();
      
      await laceUI.handleMessage(input);
      
      expect(mockActivityLogger.logEvent).toHaveBeenCalledWith(
        'user_input',
        expect.stringMatching(/^session-\d+$/),
        null,
        expect.objectContaining({
          content: input,
          timestamp: expect.any(String)
        })
      );

      // Verify timestamp is recent
      const logCall = mockActivityLogger.logEvent.mock.calls.find(
        call => call[0] === 'user_input'
      );
      const timestamp = new Date(JSON.parse(logCall![3] as string).timestamp);
      expect(timestamp.getTime()).toBeGreaterThanOrEqual(startTime);
    });

    test('should include input metadata in log', async () => {
      await laceUI.start();
      
      await laceUI.handleMessage('test command');
      
      const logCall = mockActivityLogger.logEvent.mock.calls.find(
        call => call[0] === 'user_input'
      );
      
      const logData = JSON.parse(logCall![3] as string);
      expect(logData).toMatchObject({
        content: 'test command',
        timestamp: expect.any(String),
        input_length: 12,
        session_id: expect.stringMatching(/^session-\d+$/)
      });
    });
  });

  describe('Agent Response Logging', () => {
    test('should log agent response with token usage', async () => {
      await laceUI.start();
      
      const mockAgent = laceUI['primaryAgent'];
      mockAgent.processInput.mockResolvedValue({
        content: 'Agent response',
        usage: {
          total_tokens: 150,
          input_tokens: 100,
          output_tokens: 50
        }
      });

      await laceUI.handleMessage('test');

      expect(mockActivityLogger.logEvent).toHaveBeenCalledWith(
        'agent_response',
        expect.stringMatching(/^session-\d+$/),
        null,
        expect.objectContaining({
          content: 'Agent response',
          tokens: 150,
          input_tokens: 100,
          output_tokens: 50,
          duration_ms: expect.any(Number)
        })
      );
    });

    test('should handle missing usage information gracefully', async () => {
      await laceUI.start();
      
      const mockAgent = laceUI['primaryAgent'];
      mockAgent.processInput.mockResolvedValue({
        content: 'Agent response'
        // No usage information
      });

      await laceUI.handleMessage('test');

      expect(mockActivityLogger.logEvent).toHaveBeenCalledWith(
        'agent_response',
        expect.stringMatching(/^session-\d+$/),
        null,
        expect.objectContaining({
          content: 'Agent response',
          tokens: 0,
          duration_ms: expect.any(Number)
        })
      );
    });

    test('should calculate response duration accurately', async () => {
      await laceUI.start();
      
      const mockAgent = laceUI['primaryAgent'];
      
      // Mock a delayed response
      mockAgent.processInput.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return {
          content: 'Delayed response',
          usage: { total_tokens: 100 }
        };
      });

      await laceUI.handleMessage('test');

      const logCall = mockActivityLogger.logEvent.mock.calls.find(
        call => call[0] === 'agent_response'
      );
      
      const logData = JSON.parse(logCall![3] as string);
      expect(logData.duration_ms).toBeGreaterThanOrEqual(90); // Allow for timing variance
    });
  });

  describe('Tool Execution Logging', () => {
    test('should log tool execution with input and results', async () => {
      await laceUI.start();
      
      const mockAgent = laceUI['primaryAgent'];
      mockAgent.processInput.mockResolvedValue({
        content: 'File listed',
        toolCalls: [{
          name: 'file_list',
          input: { path: '/tmp' }
        }],
        toolResults: [{
          success: true,
          files: ['file1.txt', 'file2.txt']
        }],
        usage: { total_tokens: 200 }
      });

      await laceUI.handleMessage('list files');

      expect(mockActivityLogger.logEvent).toHaveBeenCalledWith(
        'tool_execution',
        expect.stringMatching(/^session-\d+$/),
        null,
        expect.objectContaining({
          tool_name: 'file_list',
          input: { path: '/tmp' },
          result: {
            success: true,
            files: ['file1.txt', 'file2.txt']
          },
          duration_ms: expect.any(Number)
        })
      );
    });

    test('should log multiple tool executions', async () => {
      await laceUI.start();
      
      const mockAgent = laceUI['primaryAgent'];
      mockAgent.processInput.mockResolvedValue({
        content: 'Multiple tools executed',
        toolCalls: [
          { name: 'file_list', input: { path: '.' } },
          { name: 'file_read', input: { path: 'test.txt' } }
        ],
        toolResults: [
          { success: true, files: [] },
          { success: true, content: 'file content' }
        ],
        usage: { total_tokens: 300 }
      });

      await laceUI.handleMessage('read files');

      // Should log each tool execution separately
      expect(mockActivityLogger.logEvent).toHaveBeenCalledWith(
        'tool_execution',
        expect.stringMatching(/^session-\d+$/),
        null,
        expect.objectContaining({
          tool_name: 'file_list'
        })
      );

      expect(mockActivityLogger.logEvent).toHaveBeenCalledWith(
        'tool_execution',
        expect.stringMatching(/^session-\d+$/),
        null,
        expect.objectContaining({
          tool_name: 'file_read'
        })
      );
    });

    test('should log tool execution errors', async () => {
      await laceUI.start();
      
      const mockAgent = laceUI['primaryAgent'];
      mockAgent.processInput.mockResolvedValue({
        content: 'Tool failed',
        toolCalls: [{
          name: 'file_read',
          input: { path: 'nonexistent.txt' }
        }],
        toolResults: [{
          success: false,
          error: 'File not found'
        }],
        usage: { total_tokens: 100 }
      });

      await laceUI.handleMessage('read missing file');

      expect(mockActivityLogger.logEvent).toHaveBeenCalledWith(
        'tool_execution',
        expect.stringMatching(/^session-\d+$/),
        null,
        expect.objectContaining({
          tool_name: 'file_read',
          input: { path: 'nonexistent.txt' },
          result: {
            success: false,
            error: 'File not found'
          },
          duration_ms: expect.any(Number)
        })
      );
    });
  });

  describe('Streaming Token Logging', () => {
    test('should log streaming tokens when provided', async () => {
      await laceUI.start();
      
      const mockAgent = laceUI['primaryAgent'];
      let tokenCallback: (token: string) => void;
      
      mockAgent.processInput.mockImplementation(async (sessionId, input, options) => {
        tokenCallback = options.onToken;
        
        // Simulate streaming
        tokenCallback('Hello');
        tokenCallback(' ');
        tokenCallback('world');
        
        return {
          content: 'Hello world',
          usage: { total_tokens: 50 }
        };
      });

      await laceUI.handleMessage('hello');

      // Should log each token
      expect(mockActivityLogger.logEvent).toHaveBeenCalledWith(
        'streaming_token',
        expect.stringMatching(/^session-\d+$/),
        null,
        expect.objectContaining({
          token: 'Hello',
          timestamp: expect.any(String),
          position: 0
        })
      );

      expect(mockActivityLogger.logEvent).toHaveBeenCalledWith(
        'streaming_token',
        expect.stringMatching(/^session-\d+$/),
        null,
        expect.objectContaining({
          token: ' ',
          timestamp: expect.any(String),
          position: 1
        })
      );
    });

    test('should handle streaming without breaking on errors', async () => {
      mockActivityLogger.logEvent.mockImplementation(async (eventType) => {
        if (eventType === 'streaming_token') {
          throw new Error('Streaming log failed');
        }
        return Promise.resolve();
      });

      await laceUI.start();
      
      const mockAgent = laceUI['primaryAgent'];
      mockAgent.processInput.mockImplementation(async (sessionId, input, options) => {
        options.onToken('test');
        return {
          content: 'test',
          usage: { total_tokens: 10 }
        };
      });

      // Should complete successfully despite streaming log errors
      const result = await laceUI.handleMessage('test');
      expect(result.success).toBe(true);
    });
  });

  describe('Activity Retrieval Methods', () => {
    test('getRecentActivity should return recent events', async () => {
      const mockEvents = [
        { id: 1, event_type: 'user_input', timestamp: '2025-01-01T12:00:00Z' },
        { id: 2, event_type: 'agent_response', timestamp: '2025-01-01T12:00:01Z' }
      ];
      
      mockActivityLogger.getRecentEvents.mockResolvedValue(mockEvents);
      
      await laceUI.start();
      
      const events = await laceUI.getRecentActivity(10);
      
      expect(mockActivityLogger.getRecentEvents).toHaveBeenCalledWith(10);
      expect(events).toEqual(mockEvents);
    });

    test('getSessionActivity should filter by session ID', async () => {
      const sessionId = 'session-123';
      const mockEvents = [
        { id: 1, event_type: 'user_input', local_session_id: sessionId }
      ];
      
      mockActivityLogger.getEvents.mockResolvedValue(mockEvents);
      
      await laceUI.start();
      
      const events = await laceUI.getSessionActivity(sessionId);
      
      expect(mockActivityLogger.getEvents).toHaveBeenCalledWith({
        sessionId: sessionId
      });
      expect(events).toEqual(mockEvents);
    });

    test('getActivityByType should filter by event type', async () => {
      const mockEvents = [
        { id: 1, event_type: 'tool_execution', tool_name: 'file_list' }
      ];
      
      mockActivityLogger.getEvents.mockResolvedValue(mockEvents);
      
      await laceUI.start();
      
      const events = await laceUI.getActivityByType('tool_execution');
      
      expect(mockActivityLogger.getEvents).toHaveBeenCalledWith({
        eventType: 'tool_execution'
      });
      expect(events).toEqual(mockEvents);
    });

    test('activity retrieval should handle database errors gracefully', async () => {
      mockActivityLogger.getRecentEvents.mockRejectedValue(new Error('DB error'));
      
      await laceUI.start();
      
      const events = await laceUI.getRecentActivity(10);
      
      expect(events).toEqual([]); // Should return empty array on error
    });
  });

  describe('Activity Logger Cleanup', () => {
    test('should close activity logger on stop', async () => {
      await laceUI.start();
      
      laceUI.stop();
      
      expect(mockActivityLogger.close).toHaveBeenCalled();
    });

    test('should handle close errors gracefully', async () => {
      mockActivityLogger.close.mockRejectedValue(new Error('Close failed'));
      
      await laceUI.start();
      
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      laceUI.stop();
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'ActivityLogger close failed:',
        expect.any(Error)
      );
      
      consoleSpy.mockRestore();
    });
  });
});