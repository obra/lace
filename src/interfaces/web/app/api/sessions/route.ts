// ABOUTME: API route for session management in multi-agent architecture
// ABOUTME: Provides session creation, listing, and metadata management for agent containers

import { NextRequest, NextResponse } from 'next/server';
import { getAgentFromRequest } from '~/interfaces/web/lib/agent-context';
import { logger } from '~/utils/logger';
import { SessionInfo } from '~/interfaces/web/types/agent';

interface CreateSessionRequest {
  name?: string;
  metadata?: Record<string, unknown>;
}

interface ThreadInfo {
  threadId: string;
  isNew: boolean;
}

// GET endpoint to retrieve session information
export function GET(request: NextRequest): NextResponse {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');

    if (sessionId) {
      // Get specific session info with agent list
      // TODO: Implement session-specific agent listing
      const sessionInfo: SessionInfo = {
        id: sessionId,
        name: `Session ${sessionId}`,
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        agents: [], // TODO: Get agents from session
        status: 'active',
      };

      logger.info('Session retrieved:', { sessionId });
      return NextResponse.json(sessionInfo);
    } else {
      // List all sessions - for now return empty list
      // TODO: Implement session listing from ThreadManager
      const sessions: SessionInfo[] = [];
      logger.info('Sessions listed:', { count: sessions.length });
      return NextResponse.json({ sessions });
    }
  } catch (error) {
    logger.error('API session info error:', error);

    if (error instanceof Error && error.message === 'Session not found') {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to retrieve session',
      },
      { status: 500 }
    );
  }
}

// POST endpoint to create a new session
export async function POST(request: NextRequest) {
  try {
    logger.info('Session creation requested', { url: request.url });
    
    const body = (await request.json()) as CreateSessionRequest;
    logger.info('Session creation request body parsed', { name: body.name, hasMetadata: !!body.metadata });

    // Create new session (parent thread) directly through Agent
    // This will give us a proper thread ID from the core app.ts infrastructure
    logger.debug('Attempting to create agent thread through direct Agent access');
    const agent = getAgentFromRequest(request);
    const sessionInfo = agent.resumeOrCreateThread();
    
    const threadInfo: ThreadInfo = {
      threadId: sessionInfo.threadId,
      isNew: !sessionInfo.isResumed,
    };
    
    logger.info('Agent thread created successfully', { threadId: threadInfo.threadId, isNew: threadInfo.isNew });

    const response: SessionInfo = {
      id: threadInfo.threadId, // This is the session ID (parent thread)
      name: body.name || 'New Session',
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      agents: [], // Child agents will be created later
      status: 'active',
      metadata: body.metadata,
    };

    logger.info('Session created:', { sessionId: threadInfo.threadId, name: body.name });
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    logger.error('API session creation error:', error);

    // Provide more specific error information
    const errorMessage = error instanceof Error ? error.message : 'Failed to create session';
    const errorDetails = error instanceof Error ? error.stack : undefined;
    
    return NextResponse.json(
      {
        error: errorMessage,
        details: process.env.NODE_ENV === 'development' ? errorDetails : undefined,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

// DELETE endpoint to end a session
export function DELETE(request: NextRequest): NextResponse {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId parameter is required' }, { status: 400 });
    }

    // Note: Session deletion would need to be implemented through Agent pattern
    // For now, return not implemented
    return NextResponse.json(
      {
        error: 'Session deletion not yet implemented',
        note: 'This feature needs to be added to the Agent interface',
      },
      { status: 501 }
    );
  } catch (error) {
    logger.error('API session deletion error:', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to delete session',
      },
      { status: 500 }
    );
  }
}