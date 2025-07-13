// ABOUTME: API endpoint to get current Agent status and active thread information
// ABOUTME: Provides web interface with initial thread ID and session state

import { NextRequest, NextResponse } from 'next/server';
import { getAgentFromRequest } from '~/interfaces/web/lib/agent-context';
import { logger } from '~/utils/logger';

export interface AgentStatusResponse {
  hasActiveThread: boolean;
  currentThreadId?: string;
  latestThreadId?: string;
  provider: string;
  model: string;
}

export async function GET(request: NextRequest) {
  const requestId = Math.random().toString(36).substring(7);
  logger.info('Agent status API request', { requestId, url: request.url });
  
  try {
    const agent = getAgentFromRequest(request);

    // Get latest thread ID that the Agent can resume
    const latestThreadId = agent.getLatestThreadId();
    const currentThreadId = agent.getCurrentThreadId();

    const statusResponse: AgentStatusResponse = {
      hasActiveThread: Boolean(latestThreadId),
      latestThreadId: latestThreadId || undefined,
      provider: 'anthropic', // TODO: Get from Agent
      model: 'default', // TODO: Get from Agent
    };

    logger.info('Agent status retrieved:', {
      ...statusResponse,
      currentThreadId,
      agentInstance: agent.constructor.name,
    });
    return NextResponse.json(statusResponse);
  } catch (error) {
    logger.error('API agent status error:', {
      requestId,
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
    });

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to retrieve agent status',
      },
      { status: 500 }
    );
  }
}
