// ABOUTME: Unit tests for agent summary helper functionality
// ABOUTME: Tests summary generation with mocked SessionHelper and event parsing

/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { generateAgentSummary, getLastAgentResponse } from './agent-summary-helper';
import type { Agent } from '@/lib/server/lace-imports';
import type { LaceEvent, ThreadId } from '@/types/core';
import { createMockAgentInfo } from '@/__tests__/utils/agent-mocks';

// Mock logger to avoid console output and potential undefined errors
vi.mock('~/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock SessionHelper and capture constructor options
const mockExecute = vi.fn();
let capturedSessionHelperOptions:
  | { model: string; parentAgent: Agent; persona?: string }
  | undefined;
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
    // Use the centralized mock factory for consistent agent structure
    const agentInfo = createMockAgentInfo({
      threadId: 'test-agent-123' as ThreadId,
      name: 'Test Agent',
      persona: 'lace',
    });

    mockAgent = {
      threadId: agentInfo.threadId,
      getInfo: vi.fn().mockReturnValue(agentInfo),
      toString: vi.fn().mockReturnValue('test-agent-123'),
    } as unknown as Agent;

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

    it('should handle empty content from helper gracefully', async () => {
      mockExecute.mockResolvedValue({
        content: '',
        toolCalls: [],
        toolResults: [],
        tokenUsage: undefined,
      });

      // Should reject the promise when no content is returned
      let errorThrown = false;
      try {
        await generateAgentSummary(mockAgent, 'Test message');
      } catch (error) {
        errorThrown = true;
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('No summary content');
      }

      expect(errorThrown).toBe(true);
    });

    it('should handle helper execution failures gracefully', async () => {
      mockExecute.mockRejectedValue(new Error('Network error'));

      // Should reject with wrapped error when helper fails
      let errorThrown = false;
      try {
        await generateAgentSummary(mockAgent, 'Test message');
      } catch (error) {
        errorThrown = true;
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('execution failed');
      }

      expect(errorThrown).toBe(true);
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
          timestamp: new Date(),
          data: 'User message',
          context: { threadId: 'test' },
        },
        {
          id: '2',
          type: 'AGENT_MESSAGE',
          timestamp: new Date(),
          data: { content: 'First agent response' },
          context: { threadId: 'test' },
        },
        {
          id: '3',
          type: 'USER_MESSAGE',
          timestamp: new Date(),
          data: 'Another user message',
          context: { threadId: 'test' },
        },
        {
          id: '4',
          type: 'AGENT_MESSAGE',
          timestamp: new Date(),
          data: { content: 'Latest agent response' },
          context: { threadId: 'test' },
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
          timestamp: new Date(),
          data: 'User message',
          context: { threadId: 'test' },
        },
        {
          id: '2',
          type: 'TOOL_CALL',
          timestamp: new Date(),
          data: { id: 'test-call', name: 'test', arguments: {} },
          context: { threadId: 'test' },
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
          timestamp: new Date(),
          data: { content: 'Message from object format' },
          context: { threadId: 'test' },
        },
      ];

      const result = getLastAgentResponse(events);
      expect(result).toBe('Message from object format');
    });
  });
});
