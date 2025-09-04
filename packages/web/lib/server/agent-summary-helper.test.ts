// ABOUTME: Unit tests for agent summary helper functionality
// ABOUTME: Tests summary generation with mocked SessionHelper and event parsing

/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { generateAgentSummary, getLastAgentResponse } from './agent-summary-helper';
import type { Agent } from '@/lib/server/lace-imports';
import type { LaceEvent } from '@/types/core';

// Mock SessionHelper and capture constructor options
const mockExecute = vi.fn();
let capturedSessionHelperOptions: any;
vi.mock('@/lib/server/lace-imports', () => ({
  SessionHelper: vi.fn().mockImplementation((options) => {
    capturedSessionHelperOptions = options;
    return {
      execute: mockExecute,
    };
  }),
  Agent: vi.fn(),
}));

describe('agent-summary-helper', () => {
  let mockAgent: Agent;
  let _mockSessionHelper: { execute: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    mockAgent = {
      threadId: 'test-agent-123',
    } as Agent;

    _mockSessionHelper = { execute: mockExecute };
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('generateAgentSummary', () => {
    it('should use session-summary persona when creating SessionHelper', async () => {
      mockExecute.mockResolvedValue({
        content: 'Working on user authentication setup',
        toolCalls: [],
        toolResults: [],
      });

      await generateAgentSummary(mockAgent, 'Help me set up user authentication');

      // Verify SessionHelper was created with session-summary persona
      expect(capturedSessionHelperOptions).toEqual({
        model: 'fast',
        parentAgent: mockAgent,
        persona: 'session-summary',
      });
    });

    it('should generate summary with user message only', async () => {
      mockExecute.mockResolvedValue({
        content: 'Working on user authentication setup',
        toolCalls: [],
        toolResults: [],
      });

      const result = await generateAgentSummary(mockAgent, 'Help me set up user authentication');

      expect(result).toBe('Working on user authentication setup');
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('User message: "Help me set up user authentication"')
      );
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining(
          'generate a one-sentence summary of what the agent is currently working on'
        )
      );
    });

    it('should generate summary with user message and last agent response', async () => {
      mockExecute.mockResolvedValue({
        content: 'Implementing database schema for user accounts',
        toolCalls: [],
        toolResults: [],
      });

      const result = await generateAgentSummary(
        mockAgent,
        'Add password reset functionality',
        "I've set up the basic user model and authentication endpoints"
      );

      expect(result).toBe('Implementing database schema for user accounts');
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('User message: "Add password reset functionality"')
      );
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining(
          'Agent\'s last response: "I\'ve set up the basic user model and authentication endpoints"'
        )
      );
    });

    it('should throw when helper returns no content', async () => {
      mockExecute.mockResolvedValue({
        content: '',
        toolCalls: [],
        toolResults: [],
      });

      await expect(generateAgentSummary(mockAgent, 'Test message')).rejects.toThrow(
        'No summary content returned from helper'
      );
    });

    it('should re-throw when helper throws', async () => {
      mockExecute.mockRejectedValue(new Error('Network error'));

      await expect(generateAgentSummary(mockAgent, 'Test message')).rejects.toThrow(
        'Agent summary helper execution failed'
      );
    });

    it('should trim whitespace from successful response', async () => {
      mockExecute.mockResolvedValue({
        content: '   Working on file processing   \n',
        toolCalls: [],
        toolResults: [],
      });

      const result = await generateAgentSummary(mockAgent, 'Process these files');

      expect(result).toBe('Working on file processing');
    });
  });

  describe('getLastAgentResponse', () => {
    it('should return last AGENT_MESSAGE content', () => {
      const events: LaceEvent[] = [
        {
          id: '1',
          type: 'USER_MESSAGE',
          threadId: 'test',
          timestamp: new Date(),
          data: 'User message',
        },
        {
          id: '2',
          type: 'AGENT_MESSAGE',
          threadId: 'test',
          timestamp: new Date(),
          data: { content: 'First agent response' },
        },
        {
          id: '3',
          type: 'USER_MESSAGE',
          threadId: 'test',
          timestamp: new Date(),
          data: 'Another user message',
        },
        {
          id: '4',
          type: 'AGENT_MESSAGE',
          threadId: 'test',
          timestamp: new Date(),
          data: { content: 'Latest agent response' },
        },
      ];

      const result = getLastAgentResponse(events);
      expect(result).toBe('Latest agent response');
    });

    it('should return undefined when no agent messages exist', () => {
      const events: LaceEvent[] = [
        {
          id: '1',
          type: 'USER_MESSAGE',
          threadId: 'test',
          timestamp: new Date(),
          data: 'User message',
        },
        {
          id: '2',
          type: 'TOOL_CALL',
          threadId: 'test',
          timestamp: new Date(),
          data: { id: 'test-call', name: 'test', arguments: {} },
        },
      ];

      const result = getLastAgentResponse(events);
      expect(result).toBeUndefined();
    });

    it('should return undefined for empty events array', () => {
      const result = getLastAgentResponse([]);
      expect(result).toBeUndefined();
    });

    it('should handle AgentMessageData object format', () => {
      const events: LaceEvent[] = [
        {
          id: '1',
          type: 'AGENT_MESSAGE',
          threadId: 'test',
          timestamp: new Date(),
          data: { content: 'Message from object format' },
        },
      ];

      const result = getLastAgentResponse(events);
      expect(result).toBe('Message from object format');
    });
  });
});
