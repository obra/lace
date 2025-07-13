// ABOUTME: API route for agent management using proper multi-agent architecture
// ABOUTME: Provides agent listing and creation within sessions through Agent service pattern

import { NextRequest, NextResponse } from 'next/server';
import { sharedAgentService } from '~/interfaces/web/lib/agent-service';
import { logger } from '~/utils/logger';
import { AgentMetadata } from '~/interfaces/web/types/agent';

interface CreateAgentRequest {
  sessionId?: string;
  name?: string;
  provider?: string;
  model?: string;
  role?: string;
  metadata?: Record<string, unknown>;
}

interface AgentInfo {
  agentId: string;
  sessionId: string;
  id: string;
  name?: string;
  provider?: string;
  model?: string;
  role?: string;
  status: 'active' | 'busy' | 'idle' | 'completed';
  createdAt: string;
  lastActivity: string;
  currentTask?: string;
  messageCount: number;
  metadata?: Record<string, unknown>;
}

// GET endpoint to retrieve agent information
export function GET(request: NextRequest): NextResponse {
  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');
    const sessionId = searchParams.get('sessionId');

    if (agentId) {
      // Get specific agent info
      const messages = sharedAgentService.getThreadHistory(agentId);

      const agentInfo: AgentInfo = {
        agentId,
        sessionId: agentId.includes('.') ? agentId.split('.')[0] : agentId,
        id: agentId,
        status: 'active', // TODO: Determine from agent state
        createdAt: new Date().toISOString(), // TODO: Extract from first event
        lastActivity: new Date().toISOString(), // TODO: Extract from last event
        messageCount: Array.isArray(messages) ? messages.length : 0,
      };

      return NextResponse.json(agentInfo);
    } else if (sessionId) {
      // List all agents in session
      // TODO: Implement session-based agent listing
      return NextResponse.json({ error: 'Session-based agent listing not yet implemented' }, { status: 501 });
    } else {
      // List all agents
      // TODO: Implement agent listing
      return NextResponse.json({ error: 'Agent listing not yet implemented' }, { status: 501 });
    }
  } catch (error) {
    logger.error('API agent info error:', error);

    if (error instanceof Error && error.message === 'Thread not found') {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to retrieve agent',
      },
      { status: 500 }
    );
  }
}

// POST endpoint to create a new agent
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateAgentRequest;

    // Create new agent as child thread if sessionId is provided
    // Otherwise create a standalone agent
    const { threadInfo } = sharedAgentService.createAgentForThread(body.sessionId);

    const response: AgentInfo = {
      agentId: threadInfo.threadId,
      sessionId: body.sessionId || (threadInfo.threadId.includes('.') ? threadInfo.threadId.split('.')[0] : threadInfo.threadId),
      id: threadInfo.threadId,
      name: body.name,
      provider: body.provider,
      model: body.model,
      role: body.role,
      status: 'active',
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      messageCount: 0,
      metadata: body.metadata,
    };

    logger.info('Agent created:', { 
      agentId: threadInfo.threadId, 
      sessionId: body.sessionId,
      name: body.name 
    });
    
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    logger.error('API agent creation error:', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to create agent',
      },
      { status: 500 }
    );
  }
}

// DELETE endpoint to remove an agent
export function DELETE(request: NextRequest): NextResponse {
  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');

    if (!agentId) {
      return NextResponse.json({ error: 'agentId parameter is required' }, { status: 400 });
    }

    // Note: Agent deletion would need to be implemented through Agent pattern
    // For now, return not implemented
    return NextResponse.json(
      {
        error: 'Agent deletion not yet implemented',
        note: 'This feature needs to be added to the Agent interface',
      },
      { status: 501 }
    );
  } catch (error) {
    logger.error('API agent deletion error:', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to delete agent',
      },
      { status: 500 }
    );
  }
}