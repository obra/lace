// ABOUTME: REST API endpoints for session configuration - GET, PUT for configuration management
// ABOUTME: Handles session configuration retrieval and updates with validation and inheritance

import { NextRequest, NextResponse } from 'next/server';
import { getSessionService } from '@/lib/server/session-service';
import { asThreadId } from '@/types/core';
import { createSuperjsonResponse } from '@/lib/serialization';
import { z } from 'zod';

const ConfigurationSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'lmstudio', 'ollama']).optional(),
  model: z.string().optional(),
  maxTokens: z.number().positive().optional(),
  tools: z.array(z.string()).optional(),
  toolPolicies: z.record(z.enum(['allow', 'require-approval', 'deny'])).optional(),
  workingDirectory: z.string().optional(),
  environmentVariables: z.record(z.string()).optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const sessionService = getSessionService();
    const session = await sessionService.getSession(asThreadId(sessionId));

    if (!session) {
      return createSuperjsonResponse({ error: 'Session not found' }, { status: 404 });
    }

    const configuration = session.getEffectiveConfiguration();

    return createSuperjsonResponse({ configuration });
  } catch (error: unknown) {
    return createSuperjsonResponse(
      { error: error instanceof Error ? error.message : 'Failed to fetch configuration' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const validatedData = ConfigurationSchema.parse(body);

    const sessionService = getSessionService();
    const session = await sessionService.getSession(asThreadId(sessionId));

    if (!session) {
      return createSuperjsonResponse({ error: 'Session not found' }, { status: 404 });
    }

    // Update session configuration directly
    session.updateConfiguration(validatedData);
    const configuration = session.getEffectiveConfiguration();

    return createSuperjsonResponse({ configuration });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return createSuperjsonResponse(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }

    if (error instanceof Error && error.message === 'Session not found') {
      return createSuperjsonResponse({ error: 'Session not found' }, { status: 404 });
    }

    return createSuperjsonResponse(
      { error: error instanceof Error ? error.message : 'Failed to update configuration' },
      { status: 500 }
    );
  }
}
