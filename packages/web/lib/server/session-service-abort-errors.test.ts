// ABOUTME: Tests for session service error filtering during agent aborts
// ABOUTME: Ensures abort-related errors don't generate duplicate UI messages

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// Mock must be hoisted - create a shared broadcast mock
const mockBroadcast = vi.fn();
vi.mock('@/lib/event-stream-manager', () => ({
  EventStreamManager: {
    getInstance: () => ({
      broadcast: mockBroadcast,
    }),
  },
}));

vi.mock('~/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { SessionService } from './session-service';
import { asThreadId } from '@/types/core';
import { EventStreamManager } from '@/lib/event-stream-manager';
import { logger } from '~/utils/logger';
import type { Agent } from '@/lib/server/lace-imports';

describe('SessionService abort error filtering', () => {
  let sessionService: SessionService;
  let mockAgent: EventEmitter & { threadId: string };

  beforeEach(() => {
    vi.clearAllMocks();
    sessionService = new SessionService();
    mockAgent = Object.assign(new EventEmitter(), {
      threadId: 'test-session.1',
    });
  });

  afterEach(() => {
    mockAgent.removeAllListeners();
  });

  it('should filter out AbortError from UI messages', () => {
    const sessionId = asThreadId('test-session');

    // Set up event handlers
    sessionService.setupAgentEventHandlers(mockAgent as unknown as Agent, sessionId);

    // Emit an AbortError
    const abortError = new Error('Operation was aborted');
    abortError.name = 'AbortError';
    mockAgent.emit('error', { error: abortError });

    // Should log the error but not broadcast to UI
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Agent test-session.1 error:'),
      abortError
    );
    expect(mockBroadcast).not.toHaveBeenCalled();
  });

  it('should filter out generic "Request was aborted" errors', () => {
    const sessionId = asThreadId('test-session');

    sessionService.setupAgentEventHandlers(mockAgent as unknown as Agent, sessionId);

    // Emit a generic abort error
    const genericAbortError = new Error('Request was aborted');
    mockAgent.emit('error', { error: genericAbortError });

    // Should log the error but not broadcast to UI
    expect(logger.error).toHaveBeenCalled();
    expect(mockBroadcast).not.toHaveBeenCalled();
  });

  it('should filter out "Aborted" errors', () => {
    const sessionId = asThreadId('test-session');

    sessionService.setupAgentEventHandlers(mockAgent as unknown as Agent, sessionId);

    // Emit a simple "Aborted" error
    const abortedError = new Error('Aborted');
    mockAgent.emit('error', { error: abortedError });

    // Should log the error but not broadcast to UI
    expect(logger.error).toHaveBeenCalled();
    expect(mockBroadcast).not.toHaveBeenCalled();
  });

  it('should still broadcast non-abort errors to UI', () => {
    const sessionId = asThreadId('test-session');

    sessionService.setupAgentEventHandlers(mockAgent as unknown as Agent, sessionId);

    // Emit a regular error
    const regularError = new Error('Network connection failed');
    mockAgent.emit('error', { error: regularError });

    // Should log the error AND broadcast to UI
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Agent test-session.1 error:'),
      regularError
    );

    // Check that broadcast was called with the correct parameters
    expect(mockBroadcast).toHaveBeenCalledWith({
      eventType: 'session',
      scope: { sessionId },
      data: {
        type: 'LOCAL_SYSTEM_MESSAGE',
        threadId: 'test-session.1',
        timestamp: expect.any(String),
        data: { content: 'Agent error: Network connection failed' },
      },
    });
  });
});
