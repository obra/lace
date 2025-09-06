// ABOUTME: Tests for session service error filtering during agent aborts
// ABOUTME: Ensures abort-related errors don't generate duplicate UI messages

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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
import { logger } from '~/utils/logger';
import type { Agent, Session } from '@/lib/server/lace-imports';
import { createMockAgent } from '@/test-utils/mock-agent';

describe('SessionService abort error filtering', () => {
  let sessionService: SessionService;
  let mockAgent: ReturnType<typeof createMockAgent>;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionService = new SessionService();
    mockAgent = createMockAgent({
      threadId: 'lace_20250101_sess01.1',
      getFullSession: async () =>
        ({
          getId: () => 'lace_20250101_sess01',
          getProjectId: () => undefined,
        }) as Session,
    });
  });

  afterEach(() => {
    // Clear any event handlers stored in the mock
    if (mockAgent.handlers) {
      mockAgent.handlers = {};
    }
  });

  it('should filter out AbortError from UI messages', async () => {
    const _sessionId = asThreadId('lace_20250101_sess01');

    // Set up event handlers
    await sessionService.setupAgentEventHandlers(mockAgent as unknown as Agent);

    // Emit an AbortError
    const abortError = new Error('Operation was aborted');
    abortError.name = 'AbortError';
    mockAgent.emit('error', { error: abortError });

    // Should log the error but not broadcast to UI
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Agent lace_20250101_sess01.1 error:'),
      abortError
    );
    expect(mockBroadcast).not.toHaveBeenCalled();
  });

  it('should filter out generic "Request was aborted" errors', async () => {
    const _sessionId = asThreadId('lace_20250101_sess01');

    await sessionService.setupAgentEventHandlers(mockAgent as unknown as Agent);

    // Emit a generic abort error
    const genericAbortError = new Error('Request was aborted');
    mockAgent.emit('error', { error: genericAbortError });

    // Should log the error but not broadcast to UI
    expect(logger.error).toHaveBeenCalled();
    expect(mockBroadcast).not.toHaveBeenCalled();
  });

  it('should filter out "Aborted" errors', async () => {
    const _sessionId = asThreadId('lace_20250101_sess01');

    await sessionService.setupAgentEventHandlers(mockAgent as unknown as Agent);

    // Emit a simple "Aborted" error
    const abortedError = new Error('Aborted');
    mockAgent.emit('error', { error: abortedError });

    // Should log the error but not broadcast to UI
    expect(logger.error).toHaveBeenCalled();
    expect(mockBroadcast).not.toHaveBeenCalled();
  });

  it('should still process non-abort errors (AGENT_ERROR events handled by EventStreamManager)', async () => {
    const _sessionId = asThreadId('lace_20250101_sess01');

    await sessionService.setupAgentEventHandlers(mockAgent as unknown as Agent);

    // Emit a regular error with context
    const regularError = new Error('Network connection failed');
    const errorContext = {
      phase: 'provider_response',
      errorType: 'provider_failure',
      isRetryable: true,
    };
    mockAgent.emit('error', { error: regularError, context: errorContext });

    // Should log the error
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Agent lace_20250101_sess01.1 error:'),
      regularError
    );

    // Should NOT broadcast LOCAL_SYSTEM_MESSAGE (now handled by EventStreamManager as AGENT_ERROR)
    expect(mockBroadcast).not.toHaveBeenCalled();
  });
});
