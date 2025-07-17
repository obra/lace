// ABOUTME: Individual session API endpoints - GET/PATCH/DELETE specific session in project
// ABOUTME: Uses Project class methods for session management with proper validation

import { NextRequest, NextResponse } from 'next/server';
import { Project } from '@/lib/server/lace-imports';
import { z } from 'zod';

const UpdateSessionSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  configuration: z.record(z.unknown()).optional(),
  status: z.enum(['active', 'archived', 'completed']).optional(),
});

export function GET(
  _request: NextRequest,
  { params }: { params: { projectId: string; sessionId: string } }
) {
  try {
    const project = Project.getById(params.projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const session = project.getSession(params.sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found in this project' }, { status: 404 });
    }

    return NextResponse.json({ session });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch session' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { projectId: string; sessionId: string } }
) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const validatedData = UpdateSessionSchema.parse(body);

    const project = Project.getById(params.projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const session = project.updateSession(params.sessionId, validatedData);
    if (!session) {
      return NextResponse.json({ error: 'Session not found in this project' }, { status: 404 });
    }

    return NextResponse.json({ session });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update session' },
      { status: 500 }
    );
  }
}

export function DELETE(
  _request: NextRequest,
  { params }: { params: { projectId: string; sessionId: string } }
) {
  try {
    const project = Project.getById(params.projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const success = project.deleteSession(params.sessionId);
    if (!success) {
      return NextResponse.json({ error: 'Session not found in this project' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete session' },
      { status: 500 }
    );
  }
}
