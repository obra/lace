// ABOUTME: Simple message sending endpoint for existing conversations
// ABOUTME: Sends messages to active Agent thread without creating new streams

import { NextRequest } from 'next/server';
import { getAgentFromRequest } from '~/interfaces/web/lib/agent-context';
import { logger } from '~/utils/logger';

interface SendMessageRequest {
  message: string;
  threadId?: string;
}

export async function POST(request: NextRequest) {
  const requestId = Math.random().toString(36).substring(7);
  
  try {
    const body = (await request.json()) as SendMessageRequest;
    
    if (!body?.message) {
      return new Response(JSON.stringify({ error: 'Message is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const agent = getAgentFromRequest(request);
    
    // Use provided threadId or current thread
    const targetThreadId = body.threadId || agent.getCurrentThreadId();
    
    if (!targetThreadId) {
      return new Response(JSON.stringify({ error: 'No active thread found' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    logger.info('Sending message to existing thread', { 
      requestId, 
      threadId: targetThreadId,
      message: body.message 
    });

    // Send message to the active thread - events will be emitted via existing SSE connection
    await agent.sendMessage(body.message);

    return new Response(JSON.stringify({ 
      success: true, 
      threadId: targetThreadId,
      requestId 
    }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    logger.error('Message sending error:', {
      requestId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Failed to send message',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}