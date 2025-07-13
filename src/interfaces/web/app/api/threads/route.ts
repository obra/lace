// ABOUTME: API route for thread/conversation management using Agent service pattern
// ABOUTME: Provides thread listing and creation through proper Agent encapsulation

import { NextRequest, NextResponse } from 'next/server';
import { getAgentFromRequest } from '~/interfaces/web/lib/agent-context';
import { logger } from '~/utils/logger';

interface CreateThreadRequest {
  name?: string;
  metadata?: Record<string, unknown>;
}

interface ThreadInfo {
  threadId: string;
  name?: string;
  createdAt: string;
  lastActivity: string;
  messageCount: number;
  metadata?: Record<string, unknown>;
}

// GET endpoint to retrieve thread information
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const threadId = searchParams.get('threadId');

    if (!threadId) {
      return NextResponse.json({ error: 'threadId parameter is required' }, { status: 400 });
    }

    // Get thread history through agent
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

    // Calculate thread metadata from messages
    const threadInfo: ThreadInfo = {
      threadId,
      createdAt: new Date().toISOString(), // TODO: Extract from first event
      lastActivity: new Date().toISOString(), // TODO: Extract from last event
      messageCount: Array.isArray(messages) ? messages.length : 0,
    };

    return NextResponse.json(threadInfo);
  } catch (error) {
    logger.error('API thread info error:', error);

    if (error instanceof Error && error.message === 'Thread not found') {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to retrieve thread',
      },
      { status: 500 }
    );
  }
}

// POST endpoint to create a new thread through agent service
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateThreadRequest;

    // Create new thread through agent
    const agent = getAgentFromRequest(request);
    const sessionInfo = agent.resumeOrCreateThread();

    const threadInfo = {
      threadId: sessionInfo.threadId,
      isNew: !sessionInfo.isResumed,
    };

    const response: ThreadInfo = {
      threadId: threadInfo.threadId,
      name: body.name,
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      messageCount: 0,
      metadata: body.metadata,
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    logger.error('API thread creation error:', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to create thread',
      },
      { status: 500 }
    );
  }
}

// DELETE endpoint - currently not implemented in core ThreadManager
export function DELETE(request: NextRequest): NextResponse {
  try {
    const { searchParams } = new URL(request.url);
    const threadId = searchParams.get('threadId');

    if (!threadId) {
      return NextResponse.json({ error: 'threadId parameter is required' }, { status: 400 });
    }

    // Note: Thread deletion would need to be implemented through Agent pattern
    // For now, return not implemented
    return NextResponse.json(
      {
        error: 'Thread deletion not yet implemented',
        note: 'This feature needs to be added to the Agent interface',
      },
      { status: 501 }
    );
  } catch (error) {
    logger.error('API thread deletion error:', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to delete thread',
      },
      { status: 500 }
    );
  }
}
