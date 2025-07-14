// ABOUTME: Message sending API endpoint for sending messages to agent threads
// ABOUTME: Accepts messages, queues them for processing, and emits events via SSE

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getSessionService } from '@/lib/server/session-service';
import { ThreadId, MessageRequest, MessageResponse, SessionEvent } from '@/types/api';
import { SSEManager } from '@/lib/sse-manager';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
): Promise<NextResponse> {
  try {
    const sessionService = getSessionService();
    const { threadId: threadIdParam } = await params;
    const threadId = threadIdParam as ThreadId;

    // Validate thread ID format
    if (!threadId.match(/^lace_\d{8}_[a-z0-9]+(\.\d+)?$/)) {
      return NextResponse.json({ error: 'Invalid thread ID format' }, { status: 400 });
    }

    // Parse request body
    const body: MessageRequest = await request.json();
    
    if (!body.message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    if (body.message.trim() === '') {
      return NextResponse.json({ error: 'Message cannot be empty' }, { status: 400 });
    }

    // Determine session ID (parent thread for agents, or self for sessions)
    const sessionId = threadId.includes('.') 
      ? threadId.split('.')[0] as ThreadId 
      : threadId;

    // Get agent instance
    const agent = sessionService.getAgent(threadId);
    
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Set up event handlers to broadcast via SSE
    const sseManager = SSEManager.getInstance();
    
    // Emit user message event
    const userMessageEvent: SessionEvent = {
      type: 'USER_MESSAGE',
      threadId,
      timestamp: new Date().toISOString(),
      data: { content: body.message }
    };
    sseManager.broadcast(sessionId, userMessageEvent);

    agent.on('agent_thinking_start', () => {
      const event: SessionEvent = {
        type: 'THINKING',
        threadId,
        timestamp: new Date().toISOString(),
        data: { status: 'start' }
      };
      sseManager.broadcast(sessionId, event);
    });

    agent.on('agent_thinking_complete', () => {
      const event: SessionEvent = {
        type: 'THINKING',
        threadId,
        timestamp: new Date().toISOString(),
        data: { status: 'complete' }
      };
      sseManager.broadcast(sessionId, event);
    });

    agent.on('agent_response_complete', ({ content }: { content: string }) => {
      const event: SessionEvent = {
        type: 'AGENT_MESSAGE',
        threadId,
        timestamp: new Date().toISOString(),
        data: { content }
      };
      sseManager.broadcast(sessionId, event);
    });

    agent.on('tool_call_start', ({ toolName, input }: { toolName: string; input: any }) => {
      const event: SessionEvent = {
        type: 'TOOL_CALL',
        threadId,
        timestamp: new Date().toISOString(),
        data: { toolName, input }
      };
      sseManager.broadcast(sessionId, event);
    });

    agent.on('tool_call_complete', ({ toolName, result }: { toolName: string; result: any }) => {
      const event: SessionEvent = {
        type: 'TOOL_RESULT',
        threadId,
        timestamp: new Date().toISOString(),
        data: { toolName, result }
      };
      sseManager.broadcast(sessionId, event);
    });

    // Generate message ID
    const messageId = randomUUID();

    // Process message asynchronously
    agent.sendMessage(body.message).catch(error => {
      console.error('Error processing message:', error);
      // Could emit an error event here if needed
    });

    // Return immediate acknowledgment
    const response: MessageResponse = {
      status: 'accepted',
      threadId,
      messageId
    };

    return NextResponse.json(response, { status: 202 });
  } catch (error) {
    console.error('Error in POST /api/threads/[threadId]/message:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}