// ABOUTME: Integration tests for activity logging in Ink UI
// ABOUTME: Tests logging of user inputs, agent responses, tool executions, and activity retrieval

import { jest } from '@jest/globals';
import { LaceUI } from '../../../src/ui/lace-ui.js';
import { ActivityLogger } from '../../../src/logging/activity-logger.js';

// Mock ActivityLogger to test integration
jest.mock('../../../src/logging/activity-logger.js');
const MockActivityLogger = ActivityLogger as jest.MockedClass<typeof ActivityLogger>;

// Mock fullscreen-ink to avoid terminal issues in tests
jest.mock('fullscreen-ink', () => ({
  withFullScreen: jest.fn(() => ({
    start: jest.fn(() => Promise.resolve({ unmount: jest.fn() }))
  }))
}));

// Mock database components
jest.mock('../../../src/database/conversation-db.js', () => ({
  ConversationDB: jest.fn().mockImplementation(() => ({
    initialize: jest.fn(),
    saveMessage: jest.fn(),
    getMessages: jest.fn()
  }))
}));

jest.mock('../../../src/tools/tool-registry.js', () => ({
  ToolRegistry: jest.fn().mockImplementation(() => ({
    initialize: jest.fn(),
    listTools: jest.fn().mockReturnValue(['file', 'shell', 'javascript']),
    get: jest.fn().mockReturnValue(null)
  }))
}));

jest.mock('../../../src/models/model-provider.js', () => ({
  ModelProvider: jest.fn().mockImplementation(() => ({
    initialize: jest.fn()
  }))
}));

jest.mock('../../../src/agents/agent.js', () => ({
  Agent: jest.fn().mockImplementation(() => ({
    processInput: jest.fn(),
    calculateContextUsage: jest.fn().mockReturnValue({
      used: 1000,
      total: 200000,
      percentage: 0.5,
      remaining: 199000
    }),
    calculateCost: jest.fn().mockReturnValue({ estimated: 0.001 }),
    role: 'orchestrator',
    assignedModel: 'claude-3-5-sonnet-20241022',
    assignedProvider: 'anthropic',
    generation: 0,
    contextSize: 1000
  }))
}));

describe('Activity Logging Integration', () => {
  let laceUI: LaceUI;
  let mockActivityLogger: jest.Mocked<ActivityLogger>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create mock activity logger instance with only the methods we actually test
    mockActivityLogger = {
      initialize: jest.fn(),
      logEvent: jest.fn(),
      getEvents: jest.fn(),
      getRecentEvents: jest.fn(),
      close: jest.fn()
    } as any;

    // Mock constructor to return our mock instance
    MockActivityLogger.mockImplementation(() => mockActivityLogger);
    
    laceUI = new LaceUI({
      verbose: false,
      memoryPath: ':memory:',
      interactive: false
    });
  });

  describe('LaceUI Activity Logger Integration', () => {
    test('should initialize activity logger on startup', async () => {
      await laceUI.start();
      
      expect(MockActivityLogger).toHaveBeenCalledWith('.lace/activity.db');
      expect(mockActivityLogger.initialize).toHaveBeenCalled();
    });

    test('should initialize activity logger with custom path', async () => {
      const customLaceUI = new LaceUI({
        verbose: false,
        memoryPath: ':memory:',
        activityLogPath: '/custom/path/activity.db'
      });
      
      await customLaceUI.start();
      
      expect(MockActivityLogger).toHaveBeenCalledWith('/custom/path/activity.db');
    });

    test('should log user input events', async () => {
      await laceUI.start();
      
      // Mock agent response
      const mockAgent = laceUI['primaryAgent'];
      mockAgent.processInput.mockResolvedValue({
        content: 'Hello world',
        usage: { total_tokens: 100 }
      });

      await laceUI.handleMessage('hello');

      expect(mockActivityLogger.logEvent).toHaveBeenCalledWith(
        'user_input',
        expect.stringMatching(/^session-\d+$/),
        null,
        expect.objectContaining({
          content: 'hello',
          timestamp: expect.any(String)
        })
      );
    });

    test('should log agent response events', async () => {
      await laceUI.start();
      
      const mockAgent = laceUI['primaryAgent'];
      mockAgent.processInput.mockResolvedValue({
        content: 'Hello world',
        usage: { total_tokens: 100, input_tokens: 50, output_tokens: 50 }
      });

      await laceUI.handleMessage('hello');

      expect(mockActivityLogger.logEvent).toHaveBeenCalledWith(
        'agent_response',
        expect.stringMatching(/^session-\d+$/),
        null,
        expect.objectContaining({
          content: 'Hello world',
          tokens: 100,
          duration_ms: expect.any(Number)
        })
      );
    });

    test('should log tool execution events', async () => {
      await laceUI.start();
      
      const mockAgent = laceUI['primaryAgent'];
      mockAgent.processInput.mockResolvedValue({
        content: 'File listed',
        toolCalls: [{ name: 'file_list', input: { path: '.' } }],
        toolResults: [{ success: true, files: [] }],
        usage: { total_tokens: 150 }
      });

      await laceUI.handleMessage('list files');

      expect(mockActivityLogger.logEvent).toHaveBeenCalledWith(
        'tool_execution',
        expect.stringMatching(/^session-\d+$/),
        null,
        expect.objectContaining({
          tool_name: 'file_list',
          input: { path: '.' },
          result: { success: true, files: [] },
          duration_ms: expect.any(Number)
        })
      );
    });

    test('should handle activity logging errors gracefully', async () => {
      // Make activity logger throw an error
      mockActivityLogger.logEvent.mockRejectedValue(new Error('Database error'));
      
      await laceUI.start();
      
      const mockAgent = laceUI['primaryAgent'];
      mockAgent.processInput.mockResolvedValue({
        content: 'Hello world',
        usage: { total_tokens: 100 }
      });

      // Should not throw, just log error
      const result = await laceUI.handleMessage('hello');
      
      expect(result.success).toBe(true);
      expect(result.content).toBe('Hello world');
    });

    test('should log streaming token events', async () => {
      await laceUI.start();
      
      const mockAgent = laceUI['primaryAgent'];
      let tokenCallback: (token: string) => void;
      
      mockAgent.processInput.mockImplementation(async (sessionId, input, options) => {
        tokenCallback = options.onToken;
        
        // Simulate streaming tokens
        tokenCallback('Hello');
        tokenCallback(' ');
        tokenCallback('world');
        
        return {
          content: 'Hello world',
          usage: { total_tokens: 100 }
        };
      });

      await laceUI.handleMessage('hello');

      expect(mockActivityLogger.logEvent).toHaveBeenCalledWith(
        'streaming_token',
        expect.stringMatching(/^session-\d+$/),
        null,
        expect.objectContaining({
          token: 'Hello',
          timestamp: expect.any(String)
        })
      );
    });
  });

  describe('Activity Retrieval', () => {
    test('should provide method to get recent activity', async () => {
      const mockEvents = [
        {
          id: 1,
          timestamp: '2025-01-01T12:00:00Z',
          event_type: 'user_input',
          local_session_id: 'session-123',
          data: '{"content": "hello"}'
        },
        {
          id: 2,
          timestamp: '2025-01-01T12:00:01Z',
          event_type: 'agent_response',
          local_session_id: 'session-123',
          data: '{"content": "Hello world"}'
        }
      ];
      
      mockActivityLogger.getRecentEvents.mockResolvedValue(mockEvents);
      
      await laceUI.start();
      
      const events = await laceUI.getRecentActivity(10);
      
      expect(mockActivityLogger.getRecentEvents).toHaveBeenCalledWith(10);
      expect(events).toEqual(mockEvents);
    });

    test('should provide method to get session activity', async () => {
      const sessionId = 'session-123';
      const mockEvents = [
        {
          id: 1,
          timestamp: '2025-01-01T12:00:00Z',
          event_type: 'user_input',
          local_session_id: sessionId,
          data: '{"content": "hello"}'
        }
      ];
      
      mockActivityLogger.getEvents.mockResolvedValue(mockEvents);
      
      await laceUI.start();
      
      const events = await laceUI.getSessionActivity(sessionId);
      
      expect(mockActivityLogger.getEvents).toHaveBeenCalledWith({
        sessionId: sessionId
      });
      expect(events).toEqual(mockEvents);
    });

    test('should provide method to get activity by type', async () => {
      const mockEvents = [
        {
          id: 1,
          timestamp: '2025-01-01T12:00:00Z',
          event_type: 'tool_execution',
          local_session_id: 'session-123',
          data: '{"tool_name": "file_list"}'
        }
      ];
      
      mockActivityLogger.getEvents.mockResolvedValue(mockEvents);
      
      await laceUI.start();
      
      const events = await laceUI.getActivityByType('tool_execution');
      
      expect(mockActivityLogger.getEvents).toHaveBeenCalledWith({
        eventType: 'tool_execution'
      });
      expect(events).toEqual(mockEvents);
    });
  });

  describe('Activity Logger Lifecycle', () => {
    test('should close activity logger when LaceUI stops', async () => {
      await laceUI.start();
      
      laceUI.stop();
      
      expect(mockActivityLogger.close).toHaveBeenCalled();
    });

    test('should handle activity logger close errors gracefully', async () => {
      mockActivityLogger.close.mockRejectedValue(new Error('Close error'));
      
      await laceUI.start();
      
      // Should not throw
      expect(() => laceUI.stop()).not.toThrow();
    });
  });

  describe('App Component Activity Integration', () => {
    test('should pass activity logger to App component', async () => {
      await laceUI.start();

      // Verify the App component has access to activity logging methods
      expect(laceUI.getRecentActivity).toBeDefined();
      expect(laceUI.getSessionActivity).toBeDefined();
      expect(laceUI.getActivityByType).toBeDefined();
    });

    test('should handle activity commands in App component', async () => {
      const mockEvents = [
        {
          id: 1,
          timestamp: '2025-01-01T12:00:00Z',
          event_type: 'user_input',
          local_session_id: 'session-123',
          data: '{"content": "hello"}'
        }
      ];
      
      mockActivityLogger.getRecentEvents.mockResolvedValue(mockEvents);
      
      await laceUI.start();
      
      // Test that activity command handler exists
      expect(typeof laceUI.handleActivityCommand).toBe('function');
      
      const result = await laceUI.handleActivityCommand('recent', { limit: 5 });
      
      expect(result).toEqual(mockEvents);
      expect(mockActivityLogger.getRecentEvents).toHaveBeenCalledWith(5);
    });
  });
});