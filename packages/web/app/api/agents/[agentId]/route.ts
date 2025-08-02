// ABOUTME: REST API endpoints for individual agent management - GET, PUT for agent updates
// ABOUTME: Handles agent configuration updates including provider and model changes

import { NextRequest } from 'next/server';
import { getSessionService } from '@/lib/server/session-service';
import { asThreadId } from '@/types/core';
import { isValidThreadId } from '@/lib/validation/thread-id-validation';
import { createSuperjsonResponse } from '@/lib/serialization';
import { z } from 'zod';

const AgentUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  provider: z.enum(['anthropic', 'openai', 'lmstudio', 'ollama']).optional(),
  model: z.string().optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params;

    if (!isValidThreadId(agentId)) {
      return createSuperjsonResponse({ error: 'Invalid agent ID' }, { status: 400 });
    }

    const agentThreadId = asThreadId(agentId);

    // Extract sessionId from agentId (agents are child threads like sessionId.1)
    const sessionId = asThreadId(agentThreadId.split('.')[0]);

    const sessionService = getSessionService();
    const session = await sessionService.getSession(sessionId);

    if (!session) {
      return createSuperjsonResponse({ error: 'Session not found' }, { status: 404 });
    }

    const agent = session.getAgent(agentThreadId);

    if (!agent) {
      return createSuperjsonResponse({ error: 'Agent not found' }, { status: 404 });
    }

    const metadata = agent.getThreadMetadata();

    const agentResponse = {
      threadId: agent.threadId,
      name: (metadata?.name as string) || 'Agent ' + agent.threadId,
      provider: (metadata?.provider as string) || agent.providerName,
      model: (metadata?.model as string) || 'unknown',
      status: agent.getCurrentState(),
      createdAt: new Date().toISOString(), // TODO: Get actual creation time
    };

    return createSuperjsonResponse({ agent: agentResponse });
  } catch (error: unknown) {
    return createSuperjsonResponse(
      { error: error instanceof Error ? error.message : 'Failed to fetch agent' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params;

    if (!isValidThreadId(agentId)) {
      return createSuperjsonResponse({ error: 'Invalid agent ID' }, { status: 400 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const validatedData = AgentUpdateSchema.parse(body);

    const agentThreadId = asThreadId(agentId);

    // Extract sessionId from agentId (agents are child threads like sessionId.1)
    const sessionId = asThreadId(agentThreadId.split('.')[0]);

    const sessionService = getSessionService();
    const session = await sessionService.getSession(sessionId);

    if (!session) {
      return createSuperjsonResponse({ error: 'Session not found' }, { status: 404 });
    }

    const agent = session.getAgent(agentThreadId);

    if (!agent) {
      return createSuperjsonResponse({ error: 'Agent not found' }, { status: 404 });
    }

    // Update agent properties via thread metadata
    const updates: Record<string, unknown> = {};

    if (validatedData.name !== undefined) {
      updates.name = validatedData.name;
    }

    if (validatedData.provider !== undefined) {
      updates.provider = validatedData.provider;
    }

    if (validatedData.model !== undefined) {
      updates.model = validatedData.model;
    }

    if (Object.keys(updates).length > 0) {
      agent.updateThreadMetadata(updates);
    }

    const metadata = agent.getThreadMetadata();

    const agentResponse = {
      threadId: agent.threadId,
      name: (metadata?.name as string) || 'Agent ' + agent.threadId,
      provider: (metadata?.provider as string) || agent.providerName,
      model: (metadata?.model as string) || 'unknown',
      status: agent.getCurrentState(),
      createdAt: new Date().toISOString(), // TODO: Get actual creation time
    };

    return createSuperjsonResponse({ agent: agentResponse });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return createSuperjsonResponse(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }

    return createSuperjsonResponse(
      { error: error instanceof Error ? error.message : 'Failed to update agent' },
      { status: 500 }
    );
  }
}
