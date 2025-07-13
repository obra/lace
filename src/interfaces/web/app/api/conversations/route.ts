// ABOUTME: REST API for conversation management using Agent event emitter pattern
// ABOUTME: Provides synchronous conversation handling and thread history access

import { NextRequest, NextResponse } from 'next/server';
import { getAgentFromRequest } from '~/interfaces/web/lib/agent-context';
import { logger } from '~/utils/logger';

interface CreateConversationRequest {
  message: string;
  threadId?: string;
  provider?: string;
  model?: string;
}

interface ConversationResponse {
  threadId: string;
  content: string;
  toolCalls?: unknown[];
  isNew: boolean;
}

interface ThreadInfo {
  threadId: string;
  isNew: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateConversationRequest;

    if (!body.message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    // Get agent directly through request context
    const agent = getAgentFromRequest(request);
    const sessionInfo = agent.resumeOrCreateThread(body.threadId);
    
    const threadInfo: ThreadInfo = {
      threadId: sessionInfo.threadId,
      isNew: !sessionInfo.isResumed,
    };

    // Create promise to collect the response using Agent's event emitter
    const conversationPromise = new Promise<ConversationResponse>((resolve, reject) => {
      let responseContent = '';
      const toolCalls: unknown[] = [];

      // Listen for agent events - this is the proper way to get data from Agent
      agent.on('agent_token', ({ token }: { token: string }) => {
        responseContent += token;
      });

      agent.on('tool_call_start', ({ toolName, input, callId }) => {
        toolCalls.push({ name: toolName, input, id: callId });
      });

      agent.on('conversation_complete', () => {
        resolve({
          threadId: threadInfo.threadId,
          content: responseContent.trim(),
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          isNew: threadInfo.isNew,
        });
      });

      agent.on('error', ({ error }: { error: Error }) => {
        reject(error);
      });
    });

    // Start agent and send message
    await agent.start();
    await agent.sendMessage(body.message);

    // Wait for conversation to complete
    const response = await conversationPromise;

    // Clean up
    agent.stop();

    return NextResponse.json(response);
  } catch (error) {
    logger.error('API conversation error:', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to process conversation',
      },
      { status: 500 }
    );
  }
}

// GET endpoint to retrieve conversation history through shared Agent service
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const threadId = searchParams.get('threadId');

    if (!threadId) {
      return NextResponse.json({ error: 'threadId parameter is required' }, { status: 400 });
    }

    // Get conversation history through agent
    const agent = getAgentFromRequest(request);
    const threadEvents = agent.getThreadEvents(threadId);

    if (!threadEvents || threadEvents.length === 0) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    // Transform events into API-friendly format
    const messages = threadEvents
      .filter((event: any) => event.type === 'USER_MESSAGE' || event.type === 'AGENT_MESSAGE')
      .map((event: any) => ({
        id: event.id,
        type: event.type.toLowerCase().replace('_', ''),
        content: typeof event.data === 'string' ? event.data : '',
        timestamp: event.timestamp.toISOString(),
      }));

    return NextResponse.json({
      threadId,
      messages,
      totalEvents: Array.isArray(messages) ? messages.length : 0,
    });
  } catch (error) {
    logger.error('API conversation history error:', error);

    if (error instanceof Error && error.message === 'Thread not found') {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to retrieve conversation',
      },
      { status: 500 }
    );
  }
}
