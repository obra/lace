// ABOUTME: REST API for conversation management using Agent event emitter pattern
// ABOUTME: Provides synchronous conversation handling and thread history access

import { NextRequest, NextResponse } from 'next/server';
import { agentService } from '~/interfaces/web/lib/agent-service';
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

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateConversationRequest;

    if (!body.message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    // Create agent through centralized service
    const { agent, threadInfo } = await agentService.createAgent({
      provider: body.provider || 'anthropic',
      model: body.model,
      threadId: body.threadId,
    });

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

// GET endpoint to retrieve conversation history through Agent service
export function GET(request: NextRequest): NextResponse {
  try {
    const { searchParams } = new URL(request.url);
    const threadId = searchParams.get('threadId');

    if (!threadId) {
      return NextResponse.json({ error: 'threadId parameter is required' }, { status: 400 });
    }

    // Get conversation history through agent service
    const messages = agentService.getThreadHistory(threadId);

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
