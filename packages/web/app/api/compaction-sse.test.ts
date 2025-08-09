// ABOUTME: Unit test for SSE event emission during compaction
// ABOUTME: Verifies that both auto and manual compaction trigger proper SSE events

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getSessionService } from '@/lib/server/session-service';
import { EventStreamManager } from '@/lib/event-stream-manager';
import type { Agent } from '@/lib/server/lace-imports';
import { asThreadId } from '@/types/core';

describe('Compaction SSE Events', () => {
  let sseManager: EventStreamManager;
  let sessionService: ReturnType<typeof getSessionService>;
  let mockAgent: Partial<Agent> & {
    on: (event: string, handler: Function) => void;
    emit: (event: string, data?: unknown) => void;
    handlers: Record<string, Function>;
  };
  let broadcastSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Get instances
    sseManager = EventStreamManager.getInstance();
    sessionService = getSessionService();

    // Spy on broadcast
    broadcastSpy = vi.spyOn(sseManager, 'broadcast');

    // Create mock agent with event emitter capabilities
    mockAgent = {
      on: vi.fn((event: string, handler: Function) => {
        // Store handlers for manual triggering
        mockAgent.handlers = mockAgent.handlers || {};
        mockAgent.handlers[event] = handler;
        return mockAgent as unknown as Agent;
      }),
      emit: (event: string, data?: unknown) => {
        const handler = mockAgent.handlers?.[event];
        if (handler) handler(data);
        return true;
      },
      handlers: {},
    };
  });

  it('should emit COMPACTION_START when agent emits compaction_start event', () => {
    const _threadId = 'test-thread-123';
    const sessionId = 'test-session-456';
    const projectId = 'test-project-789';

    // Set up session service with project ID
    (sessionService as { projectId?: string }).projectId = projectId;

    // Setup event handlers
    sessionService.setupAgentEventHandlers(mockAgent as unknown as Agent, asThreadId(sessionId));

    // Trigger compaction start event
    mockAgent.emit('compaction_start', {
      auto: true,
    });

    // Verify COMPACTION_START was broadcast
    expect(broadcastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'thread',
        scope: expect.objectContaining({
          projectId,
          sessionId,
        }),
        data: expect.objectContaining({
          type: 'COMPACTION_START',
          data: expect.objectContaining({
            strategy: 'summarize',
            auto: true,
          }),
        }),
      })
    );
  });

  it('should emit COMPACTION_COMPLETE when agent emits compaction_complete event', () => {
    const _threadId = 'test-thread-123';
    const sessionId = 'test-session-456';
    const projectId = 'test-project-789';

    (sessionService as { projectId?: string }).projectId = projectId;
    sessionService.setupAgentEventHandlers(mockAgent as unknown as Agent, asThreadId(sessionId));

    // Trigger compaction complete event
    mockAgent.emit('compaction_complete', {
      success: true,
    });

    // Verify COMPACTION_COMPLETE was broadcast
    expect(broadcastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'thread',
        scope: expect.objectContaining({
          projectId,
          sessionId,
        }),
        data: expect.objectContaining({
          type: 'COMPACTION_COMPLETE',
          data: expect.objectContaining({
            success: true,
          }),
        }),
      })
    );
  });

  it('should handle manual compact command SSE events', () => {
    const sessionId = 'test-session-456';
    const projectId = 'test-project-789';

    (sessionService as { projectId?: string }).projectId = projectId;
    sessionService.setupAgentEventHandlers(mockAgent as unknown as Agent, asThreadId(sessionId));

    // Trigger manual compaction start
    mockAgent.emit('compaction_start', {
      auto: false,
    });

    // Verify COMPACTION_START was broadcast
    expect(broadcastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'COMPACTION_START',
          data: expect.objectContaining({
            auto: false,
          }),
        }),
      })
    );

    // Clear and complete
    broadcastSpy.mockClear();
    mockAgent.emit('compaction_complete', {
      success: true,
    });

    // Verify COMPACTION_COMPLETE was broadcast
    expect(broadcastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'COMPACTION_COMPLETE',
          data: expect.objectContaining({
            success: true,
          }),
        }),
      })
    );
  });

  it('should differentiate between auto and manual compaction events', () => {
    const sessionId = 'test-session-456';
    const projectId = 'test-project-789';

    (sessionService as { projectId?: string }).projectId = projectId;
    sessionService.setupAgentEventHandlers(mockAgent as unknown as Agent, asThreadId(sessionId));

    // Trigger auto compaction
    mockAgent.emit('compaction_start', {
      auto: true,
    });

    // Verify auto flag is true
    expect(broadcastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'COMPACTION_START',
          data: expect.objectContaining({
            auto: true,
          }),
        }),
      })
    );

    broadcastSpy.mockClear();

    // Trigger manual compaction
    mockAgent.emit('compaction_start', {
      auto: false,
    });

    // Verify auto flag is false
    expect(broadcastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'COMPACTION_START',
          data: expect.objectContaining({
            auto: false,
          }),
        }),
      })
    );
  });
});
