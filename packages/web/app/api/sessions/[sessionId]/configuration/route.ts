// ABOUTME: REST API endpoints for session configuration - GET, PUT for configuration management
// ABOUTME: Handles session configuration retrieval and updates with validation and inheritance

import { NextRequest, NextResponse } from 'next/server';
import { getSessionService } from '@/lib/server/session-service';
import { z } from 'zod';

const ConfigurationSchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  maxTokens: z.number().positive().optional(),
  tools: z.array(z.string()).optional(),
  toolPolicies: z.record(z.enum(['allow', 'require-approval', 'deny'])).optional(),
  workingDirectory: z.string().optional(),
  environmentVariables: z.record(z.string()).optional(),
});

export async function GET(request: NextRequest, { params }: { params: { sessionId: string } }) {
  try {
    const sessionService = getSessionService();
    const session = await sessionService.getSession(params.sessionId);

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const configuration = session.getEffectiveConfiguration();

    return NextResponse.json({ configuration });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch configuration' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, { params }: { params: { sessionId: string } }) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const validatedData = ConfigurationSchema.parse(body);

    const sessionService = getSessionService();
    const session = await sessionService.getSession(params.sessionId);

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Update session configuration directly
    session.updateConfiguration(validatedData);
    const configuration = session.getEffectiveConfiguration();

    return NextResponse.json({ configuration });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }

    if (error instanceof Error && error.message === 'Session not found') {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update configuration' },
      { status: 500 }
    );
  }
}
