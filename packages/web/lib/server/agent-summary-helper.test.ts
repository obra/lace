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

// Mock SessionHelper
vi.mock('~/helpers/session-helper', () => ({
  SessionHelper: vi.fn().mockImplementation(() => ({
    execute: vi.fn(),
  })),
}));

describe('agent-summary-helper', () => {
  let mockAgent: Agent;
  let mockSessionHelper: { execute: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    mockAgent = {
      threadId: 'test-agent-123',
    } as Agent;

    // Get the mocked SessionHelper constructor
    const { SessionHelper } = vi.mocked(await import('~/helpers/session-helper'));
    mockSessionHelper = { execute: vi.fn() };
    SessionHelper.mockReturnValue(mockSessionHelper);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('generateAgentSummary', () => {
    it('should generate summary with user message only', async () => {
      mockSessionHelper.execute.mockResolvedValue({
        success: true,
        response: 'Working on user authentication setup',
      });

      const result = await generateAgentSummary(mockAgent, 'Help me set up user authentication');

      expect(result).toBe('Working on user authentication setup');
      expect(mockSessionHelper.execute).toHaveBeenCalledWith(
        expect.stringContaining('User message: "Help me set up user authentication"')
      );
      expect(mockSessionHelper.execute).toHaveBeenCalledWith(
        expect.stringContaining('put together a clear one-sentence summary')
      );
    });

    it('should generate summary with user message and last agent response', async () => {
      mockSessionHelper.execute.mockResolvedValue({
        success: true,
        response: 'Implementing database schema for user accounts',
      });

      const result = await generateAgentSummary(
        mockAgent,
        'Add password reset functionality',
        "I've set up the basic user model and authentication endpoints"
      );

      expect(result).toBe('Implementing database schema for user accounts');
      expect(mockSessionHelper.execute).toHaveBeenCalledWith(
        expect.stringContaining('User message: "Add password reset functionality"')
      );
      expect(mockSessionHelper.execute).toHaveBeenCalledWith(
        expect.stringContaining(
          'Agent\'s last response: "I\'ve set up the basic user model and authentication endpoints"'
        )
      );
    });

    it('should return fallback message when helper fails', async () => {
      mockSessionHelper.execute.mockResolvedValue({
        success: false,
        error: 'Provider connection failed',
      });

      const result = await generateAgentSummary(mockAgent, 'Test message');

      expect(result).toBe('Processing your request');
    });

    it('should return fallback message when helper throws', async () => {
      mockSessionHelper.execute.mockRejectedValue(new Error('Network error'));

      const result = await generateAgentSummary(mockAgent, 'Test message');

      expect(result).toBe('Processing your request');
    });

    it('should trim whitespace from successful response', async () => {
      mockSessionHelper.execute.mockResolvedValue({
        success: true,
        response: '   Working on file processing   \n',
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
          data: 'First agent response',
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
          data: 'Latest agent response',
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
          data: { name: 'test', args: {} },
        },
      ];

      const result = getLastAgentResponse(events);
      expect(result).toBeUndefined();
    });

    it('should return undefined for empty events array', () => {
      const result = getLastAgentResponse([]);
      expect(result).toBeUndefined();
    });

    it('should handle non-string agent message data', () => {
      const events: LaceEvent[] = [
        {
          id: '1',
          type: 'AGENT_MESSAGE',
          threadId: 'test',
          timestamp: new Date(),
          data: { content: 'This is not a string' }, // Non-string data
        },
      ];

      const result = getLastAgentResponse(events);
      expect(result).toBeUndefined();
    });
  });
});
