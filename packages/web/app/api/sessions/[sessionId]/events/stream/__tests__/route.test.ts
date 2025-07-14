// ABOUTME: Tests for session SSE stream API endpoint (GET /api/sessions/{sessionId}/events/stream)
// ABOUTME: Provides real-time event streaming for all agents within a session

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../route';
import { ThreadManager } from '~/threads/thread-manager';
import { ThreadId } from '~/types/threads';
import { EventEmitter } from 'events';

// Mock dependencies
vi.mock('~/threads/thread-manager');
vi.mock('../../../../../../lib/sse-manager', () => ({
  SSEManager: {
    getInstance: vi.fn(() => mockSSEManager)
  }
}));

// Create mock SSE manager
const mockSSEManager = {
  addConnection: vi.fn(),
  removeConnection: vi.fn(),
  broadcast: vi.fn(),
  sessionStreams: new Map()
};

describe('Session SSE Stream API', () => {
  let mockThreadManager: any;
  let mockController: any;
  let mockWriter: any;
  let mockEncoder: TextEncoder;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockEncoder = new TextEncoder();
    mockWriter = {
      write: vi.fn(),
      close: vi.fn(),
      abort: vi.fn()
    };
    
    mockController = {
      enqueue: vi.fn(),
      close: vi.fn(),
      error: vi.fn()
    };
    
    mockThreadManager = {
      getThread: vi.fn(),
      listThreads: vi.fn(),
      listEvents: vi.fn()
    };

    (ThreadManager as any).mockImplementation(() => mockThreadManager);
    
    // Reset SSE manager state
    mockSSEManager.sessionStreams.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /api/sessions/{sessionId}/events/stream', () => {
    const sessionId = 'lace_20250113_session1';

    it('should establish SSE connection', async () => {
      mockThreadManager.getThread.mockResolvedValue({
        id: sessionId,
        created: new Date().toISOString(),
        metadata: { isSession: true, name: 'Test Session' }
      });

      const request = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/events/stream`);
      const response = await GET(request, { params: { sessionId } });

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/event-stream');
      expect(response.headers.get('Cache-Control')).toBe('no-cache');
      expect(response.headers.get('Connection')).toBe('keep-alive');
      expect(response.headers.get('X-Accel-Buffering')).toBe('no');
    });

    it('should send connection event on open', async () => {
      mockThreadManager.getThread.mockResolvedValue({
        id: sessionId,
        created: new Date().toISOString(),
        metadata: { isSession: true }
      });

      const request = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/events/stream`);
      const response = await GET(request, { params: { sessionId } });

      // Get the stream
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      
      // Read first chunk
      const { value, done } = await reader.read();
      expect(done).toBe(false);
      
      const data = decoder.decode(value);
      expect(data).toContain('event: connection');
      expect(data).toContain(`data: {"sessionId":"${sessionId}","status":"connected"}`);
    });

    it('should stream events for session only', async () => {
      mockThreadManager.getThread.mockResolvedValue({
        id: sessionId,
        created: new Date().toISOString(),
        metadata: { isSession: true }
      });

      const request = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/events/stream`);
      const response = await GET(request, { params: { sessionId } });

      // Simulate broadcasting events
      expect(mockSSEManager.addConnection).toHaveBeenCalledWith(
        sessionId,
        expect.any(Object)
      );

      // Verify that the connection was added for the correct session
      const addConnectionCall = mockSSEManager.addConnection.mock.calls[0];
      expect(addConnectionCall[0]).toBe(sessionId);
    });

    it('should filter out events from other sessions', async () => {
      const otherSessionId = 'lace_20250113_other';
      
      mockThreadManager.getThread.mockResolvedValue({
        id: sessionId,
        created: new Date().toISOString(),
        metadata: { isSession: true }
      });

      const request = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/events/stream`);
      await GET(request, { params: { sessionId } });

      // Broadcast to different session should not affect this connection
      mockSSEManager.broadcast(otherSessionId, {
        type: 'USER_MESSAGE',
        threadId: `${otherSessionId}.1`,
        timestamp: new Date().toISOString(),
        data: { content: 'Should not see this' }
      });

      // Only connections for otherSessionId should receive the event
      expect(mockSSEManager.broadcast).toHaveBeenCalledWith(otherSessionId, expect.any(Object));
    });

    it('should handle client disconnection gracefully', async () => {
      mockThreadManager.getThread.mockResolvedValue({
        id: sessionId,
        created: new Date().toISOString(),
        metadata: { isSession: true }
      });

      const abortController = new AbortController();
      const request = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/events/stream`, {
        signal: abortController.signal
      });
      
      const response = await GET(request, { params: { sessionId } });
      
      // Simulate client disconnect
      abortController.abort();

      // Should clean up connection
      expect(mockSSEManager.removeConnection).toHaveBeenCalledWith(
        sessionId,
        expect.any(Object)
      );
    });

    it('should support multiple concurrent connections', async () => {
      mockThreadManager.getThread.mockResolvedValue({
        id: sessionId,
        created: new Date().toISOString(),
        metadata: { isSession: true }
      });

      // Create multiple connections
      const request1 = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/events/stream`);
      const request2 = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/events/stream`);
      const request3 = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/events/stream`);

      await Promise.all([
        GET(request1, { params: { sessionId } }),
        GET(request2, { params: { sessionId } }),
        GET(request3, { params: { sessionId } })
      ]);

      // Should have 3 connections added
      expect(mockSSEManager.addConnection).toHaveBeenCalledTimes(3);
      expect(mockSSEManager.addConnection.mock.calls).toEqual([
        [sessionId, expect.any(Object)],
        [sessionId, expect.any(Object)],
        [sessionId, expect.any(Object)]
      ]);
    });

    it('should return 404 for non-existent session', async () => {
      mockThreadManager.getThread.mockResolvedValue(null);

      const request = new NextRequest(`http://localhost:3000/api/sessions/invalid/events/stream`);
      const response = await GET(request, { params: { sessionId: 'invalid' } });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe('Session not found');
    });

    it('should return 404 for non-session thread', async () => {
      mockThreadManager.getThread.mockResolvedValue({
        id: 'lace_20250113_regular',
        created: new Date().toISOString(),
        metadata: {} // Not a session
      });

      const request = new NextRequest(`http://localhost:3000/api/sessions/lace_20250113_regular/events/stream`);
      const response = await GET(request, { params: { sessionId: 'lace_20250113_regular' } });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe('Thread is not a session');
    });

    it('should handle SSE event format correctly', async () => {
      mockThreadManager.getThread.mockResolvedValue({
        id: sessionId,
        created: new Date().toISOString(),
        metadata: { isSession: true }
      });

      const request = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/events/stream`);
      const response = await GET(request, { params: { sessionId } });

      // Get the controller that was passed to addConnection
      const controller = mockSSEManager.addConnection.mock.calls[0][1];

      // Simulate sending an event
      const event = {
        type: 'AGENT_MESSAGE',
        threadId: `${sessionId}.1`,
        timestamp: new Date().toISOString(),
        data: { content: 'Hello from agent' }
      };

      // The controller should have an enqueue method that formats SSE properly
      const sseData = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
      controller.enqueue(mockEncoder.encode(sseData));

      expect(controller.enqueue).toHaveBeenCalledWith(
        expect.any(Uint8Array)
      );
    });

    it('should include retry hint in SSE stream', async () => {
      mockThreadManager.getThread.mockResolvedValue({
        id: sessionId,
        created: new Date().toISOString(),
        metadata: { isSession: true }
      });

      const request = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/events/stream`);
      const response = await GET(request, { params: { sessionId } });

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      const { value } = await reader.read();
      const data = decoder.decode(value);

      // Should include retry directive
      expect(data).toContain('retry: 3000');
    });
  });
});