// ABOUTME: Tests for thread messaging API endpoint (POST /api/threads/{threadId}/message)
// ABOUTME: Handles sending messages to specific agent threads and emitting events via SSE

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../route';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { ThreadId } from '~/types/threads';
import { ProviderManager } from '~/providers/provider-manager';
import { ToolExecutor } from '~/tools/tool-executor';
import { EventEmitter } from 'events';

// Mock dependencies
vi.mock('~/agents/agent');
vi.mock('~/threads/thread-manager');
vi.mock('~/providers/provider-manager');
vi.mock('~/tools/tool-executor');
vi.mock('~/config/runtime-config', () => ({
  getRuntimeConfig: vi.fn(() => ({
    provider: 'anthropic',
    model: 'claude-3-haiku-20240307'
  }))
}));

// Mock SSE manager (to be implemented)
vi.mock('../../../../../../lib/sse-manager', () => ({
  SSEManager: {
    getInstance: vi.fn(() => ({
      broadcast: vi.fn()
    }))
  }
}));

describe('Thread Messaging API', () => {
  let mockThreadManager: any;
  let mockProviderManager: any;
  let mockToolExecutor: any;
  let mockAgent: any;
  let mockProvider: any;
  let agentEventEmitter: EventEmitter;

  beforeEach(() => {
    vi.clearAllMocks();
    agentEventEmitter = new EventEmitter();
    
    mockProvider = {
      getName: vi.fn(() => 'anthropic'),
      complete: vi.fn()
    };
    
    mockThreadManager = {
      getThread: vi.fn(),
      addEvent: vi.fn(),
      listEvents: vi.fn(() => [])
    };
    
    mockProviderManager = {
      getProvider: vi.fn(() => mockProvider)
    };
    
    mockToolExecutor = {
      registerTool: vi.fn(),
      executeTool: vi.fn()
    };
    
    mockAgent = {
      threadId: 'lace_20250113_session1.1' as ThreadId,
      getProviderInfo: vi.fn(() => ({ provider: 'anthropic', model: 'claude-3-haiku-20240307' })),
      getState: vi.fn(() => 'idle'),
      processUserMessage: vi.fn(),
      on: agentEventEmitter.on.bind(agentEventEmitter),
      off: agentEventEmitter.off.bind(agentEventEmitter),
      emit: agentEventEmitter.emit.bind(agentEventEmitter),
      abort: vi.fn()
    };

    (ThreadManager as any).mockImplementation(() => mockThreadManager);
    (ProviderManager as any).mockImplementation(() => mockProviderManager);
    (ToolExecutor as any).mockImplementation(() => mockToolExecutor);
    (Agent as any).mockImplementation(() => mockAgent);
  });

  afterEach(() => {
    agentEventEmitter.removeAllListeners();
  });

  describe('POST /api/threads/{threadId}/message', () => {
    const threadId = 'lace_20250113_session1.1' as ThreadId;
    const sessionId = 'lace_20250113_session1';

    it('should accept message and queue for processing', async () => {
      mockThreadManager.getThread.mockResolvedValue({
        id: threadId,
        created: new Date().toISOString(),
        metadata: { agentName: 'pm', provider: 'anthropic', model: 'claude-3-haiku-20240307' }
      });

      const request = new NextRequest(`http://localhost:3000/api/threads/${threadId}/message`, {
        method: 'POST',
        body: JSON.stringify({ message: 'Help me implement OAuth' }),
        headers: { 'Content-Type': 'application/json' }
      });

      const response = await POST(request, { params: { threadId } });
      const data = await response.json();

      expect(response.status).toBe(202);
      expect(data).toMatchObject({
        status: 'accepted',
        threadId,
        messageId: expect.any(String)
      });
      expect(mockAgent.processUserMessage).toHaveBeenCalledWith('Help me implement OAuth');
    });

    it('should return immediate acknowledgment', async () => {
      mockThreadManager.getThread.mockResolvedValue({
        id: threadId,
        created: new Date().toISOString(),
        metadata: { agentName: 'architect' }
      });

      // Simulate slow processing
      mockAgent.processUserMessage.mockImplementation(() => 
        new Promise(resolve => setTimeout(resolve, 1000))
      );

      const start = Date.now();
      const request = new NextRequest(`http://localhost:3000/api/threads/${threadId}/message`, {
        method: 'POST',
        body: JSON.stringify({ message: 'Design the architecture' }),
        headers: { 'Content-Type': 'application/json' }
      });

      const response = await POST(request, { params: { threadId } });
      const duration = Date.now() - start;

      expect(response.status).toBe(202);
      expect(duration).toBeLessThan(100); // Should return immediately
    });

    it('should validate threadId format', async () => {
      const invalidThreadId = 'invalid_thread_id';
      
      const request = new NextRequest(`http://localhost:3000/api/threads/${invalidThreadId}/message`, {
        method: 'POST',
        body: JSON.stringify({ message: 'Test message' }),
        headers: { 'Content-Type': 'application/json' }
      });

      const response = await POST(request, { params: { threadId: invalidThreadId } });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid thread ID format');
    });

    it('should handle non-existent threadId', async () => {
      mockThreadManager.getThread.mockResolvedValue(null);

      const request = new NextRequest(`http://localhost:3000/api/threads/${threadId}/message`, {
        method: 'POST',
        body: JSON.stringify({ message: 'Test message' }),
        headers: { 'Content-Type': 'application/json' }
      });

      const response = await POST(request, { params: { threadId } });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Thread not found');
    });

    it('should emit events via session SSE stream', async () => {
      const SSEManager = await import('../../../../../../lib/sse-manager').then(m => m.SSEManager);
      const mockSSEManager = SSEManager.getInstance();
      
      mockThreadManager.getThread.mockResolvedValue({
        id: threadId,
        created: new Date().toISOString(),
        metadata: { agentName: 'pm' }
      });

      const request = new NextRequest(`http://localhost:3000/api/threads/${threadId}/message`, {
        method: 'POST',
        body: JSON.stringify({ message: 'Test message' }),
        headers: { 'Content-Type': 'application/json' }
      });

      await POST(request, { params: { threadId } });

      // Simulate agent emitting events
      agentEventEmitter.emit('agent_thinking_start');
      agentEventEmitter.emit('agent_message', { content: 'I can help with that' });

      // Events should be broadcast to the session
      expect(mockSSEManager.broadcast).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          type: 'AGENT_MESSAGE',
          threadId,
          data: expect.any(Object)
        })
      );
    });

    it('should validate message is not empty', async () => {
      mockThreadManager.getThread.mockResolvedValue({
        id: threadId,
        created: new Date().toISOString(),
        metadata: { agentName: 'pm' }
      });

      const request = new NextRequest(`http://localhost:3000/api/threads/${threadId}/message`, {
        method: 'POST',
        body: JSON.stringify({ message: '' }),
        headers: { 'Content-Type': 'application/json' }
      });

      const response = await POST(request, { params: { threadId } });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Message cannot be empty');
    });

    it('should handle missing message field', async () => {
      mockThreadManager.getThread.mockResolvedValue({
        id: threadId,
        created: new Date().toISOString(),
        metadata: { agentName: 'pm' }
      });

      const request = new NextRequest(`http://localhost:3000/api/threads/${threadId}/message`, {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' }
      });

      const response = await POST(request, { params: { threadId } });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Message is required');
    });

    it('should handle agent processing errors gracefully', async () => {
      mockThreadManager.getThread.mockResolvedValue({
        id: threadId,
        created: new Date().toISOString(),
        metadata: { agentName: 'pm' }
      });

      mockAgent.processUserMessage.mockRejectedValue(new Error('Provider error'));

      const request = new NextRequest(`http://localhost:3000/api/threads/${threadId}/message`, {
        method: 'POST',
        body: JSON.stringify({ message: 'Test message' }),
        headers: { 'Content-Type': 'application/json' }
      });

      const response = await POST(request, { params: { threadId } });
      
      // Should still return 202 as processing happens async
      expect(response.status).toBe(202);
    });

    it('should support sending to both session and agent threads', async () => {
      // Test session thread
      const sessionThreadId = 'lace_20250113_session1' as ThreadId;
      mockThreadManager.getThread.mockResolvedValue({
        id: sessionThreadId,
        created: new Date().toISOString(),
        metadata: { isSession: true, name: 'Test Session' }
      });

      const sessionRequest = new NextRequest(`http://localhost:3000/api/threads/${sessionThreadId}/message`, {
        method: 'POST',
        body: JSON.stringify({ message: 'Message to session' }),
        headers: { 'Content-Type': 'application/json' }
      });

      const sessionResponse = await POST(sessionRequest, { params: { threadId: sessionThreadId } });
      expect(sessionResponse.status).toBe(202);

      // Test agent thread
      mockThreadManager.getThread.mockResolvedValue({
        id: threadId,
        created: new Date().toISOString(),
        metadata: { agentName: 'pm' }
      });

      const agentRequest = new NextRequest(`http://localhost:3000/api/threads/${threadId}/message`, {
        method: 'POST',
        body: JSON.stringify({ message: 'Message to agent' }),
        headers: { 'Content-Type': 'application/json' }
      });

      const agentResponse = await POST(agentRequest, { params: { threadId } });
      expect(agentResponse.status).toBe(202);
    });
  });
});