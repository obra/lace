// ABOUTME: Unit test for SSE event emission during compaction
// ABOUTME: Verifies that both auto and manual compaction trigger proper SSE events

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getSessionService } from '@/lib/server/session-service';
import { EventStreamManager } from '@/lib/event-stream-manager';
import { Agent } from '@/lib/server/lace-imports';

describe('Compaction SSE Events', () => {
  let sseManager: EventStreamManager;
  let sessionService: any;
  let mockAgent: any;
  let broadcastSpy: any;

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
      }),
      emit: (event: string, data?: any) => {
        const handler = mockAgent.handlers?.[event];
        if (handler) handler(data);
      },
      handlers: {},
    };
  });

  it('should emit COMPACTION_START when agent emits thinking with compact message', () => {
    const threadId = 'test-thread-123';
    const sessionId = 'test-session-456';
    const projectId = 'test-project-789';
    
    // Set up session service with project ID
    sessionService.projectId = projectId;
    
    // Setup event handlers
    sessionService.setupAgentEventHandlers(mockAgent, sessionId);
    
    // Trigger auto-compaction thinking event
    mockAgent.emit('agent_thinking_start', {
      message: 'Auto-compacting conversation to manage token usage...'
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
            message: expect.stringContaining('compact'),
          }),
        }),
      })
    );
  });

  it('should emit COMPACTION_COMPLETE when agent completes thinking after compaction', () => {
    const threadId = 'test-thread-123';
    const sessionId = 'test-session-456';
    const projectId = 'test-project-789';
    
    sessionService.projectId = projectId;
    sessionService.setupAgentEventHandlers(mockAgent, sessionId);
    
    // First trigger compaction start
    mockAgent.emit('agent_thinking_start', {
      message: 'Compacting conversation...'
    });
    
    // Clear the spy to check only the complete event
    broadcastSpy.mockClear();
    
    // Then complete it
    mockAgent.emit('agent_thinking_complete');
    
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
    
    sessionService.projectId = projectId;
    sessionService.setupAgentEventHandlers(mockAgent, sessionId);
    
    // Trigger manual compaction
    mockAgent.emit('agent_thinking_start', {
      message: 'Compacting conversation...'
    });
    
    expect(broadcastSpy).toHaveBeenCalled();
    
    // Clear and complete
    broadcastSpy.mockClear();
    mockAgent.emit('agent_thinking_complete');
    
    expect(broadcastSpy).toHaveBeenCalled();
  });

  it('should not emit compaction events for non-compaction thinking', () => {
    const sessionId = 'test-session-456';
    const projectId = 'test-project-789';
    
    sessionService.projectId = projectId;
    sessionService.setupAgentEventHandlers(mockAgent, sessionId);
    
    // Trigger regular thinking (not compaction)
    mockAgent.emit('agent_thinking_start', {
      message: 'Processing your request...'
    });
    
    // Should not emit COMPACTION_START
    expect(broadcastSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'COMPACTION_START',
        }),
      })
    );
  });
});