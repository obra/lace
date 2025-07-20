// ABOUTME: Session API endpoints under projects hierarchy - GET sessions by project, POST new session
// ABOUTME: Uses Project class methods for session management with proper project-session relationships

import { NextRequest, NextResponse } from 'next/server';
import { Project } from '@/lib/server/lace-imports';
import { getSessionService } from '@/lib/server/session-service';
import { z } from 'zod';

const CreateSessionSchema = z.object({
  name: z.string().min(1, 'Session name is required'),
  description: z.string().optional(),
  configuration: z.record(z.unknown()).optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const project = Project.getById(projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const sessionData = project.getSessions();

    // Convert SessionData to Session format (without agents for list efficiency)
    const sessions = sessionData.map((data) => ({
      id: data.id,
      name: data.name,
      createdAt: data.createdAt.toISOString(),
      // agents will be populated when individual session is selected
    }));

    return NextResponse.json({ sessions });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch sessions' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const validatedData = CreateSessionSchema.parse(body);

    const project = Project.getById(projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Use sessionService to create session, which handles both database and in-memory management
    const sessionService = getSessionService();
    const session = await sessionService.createSession(
      validatedData.name,
      (validatedData.configuration?.provider as string) || 'anthropic',
      (validatedData.configuration?.model as string) || 'claude-3-haiku-20240307',
      projectId
    );

    return NextResponse.json({ session }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create session' },
      { status: 500 }
    );
  }
}
