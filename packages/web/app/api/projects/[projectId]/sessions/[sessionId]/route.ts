// ABOUTME: Individual session API endpoints - GET/PATCH/DELETE specific session in project
// ABOUTME: Uses Project class methods for session management with proper validation

import { NextRequest, NextResponse } from 'next/server';
import { Project } from '@/lib/server/lace-imports';
import { createSuperjsonResponse } from '@/lib/serialization';
import { z } from 'zod';

const UpdateSessionSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  configuration: z.record(z.unknown()).optional(),
  status: z.enum(['active', 'archived', 'completed']).optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; sessionId: string }> }
): Promise<NextResponse> {
  try {
    const { projectId, sessionId } = await params;
    const project = Project.getById(projectId);
    if (!project) {
      return createSuperjsonResponse({ error: 'Project not found' }, { status: 404 });
    }

    const session = project.getSession(sessionId);
    if (!session) {
      return createSuperjsonResponse(
        { error: 'Session not found in this project' },
        { status: 404 }
      );
    }

    return createSuperjsonResponse({ session });
  } catch (error: unknown) {
    return createSuperjsonResponse(
      { error: error instanceof Error ? error.message : 'Failed to fetch session' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; sessionId: string }> }
): Promise<NextResponse> {
  try {
    const { projectId, sessionId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const validatedData = UpdateSessionSchema.parse(body);

    const project = Project.getById(projectId);
    if (!project) {
      return createSuperjsonResponse({ error: 'Project not found' }, { status: 404 });
    }

    const session = project.updateSession(sessionId, validatedData);
    if (!session) {
      return createSuperjsonResponse(
        { error: 'Session not found in this project' },
        { status: 404 }
      );
    }

    return createSuperjsonResponse({ session });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return createSuperjsonResponse(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }

    return createSuperjsonResponse(
      { error: error instanceof Error ? error.message : 'Failed to update session' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; sessionId: string }> }
): Promise<NextResponse> {
  try {
    const { projectId, sessionId } = await params;
    const project = Project.getById(projectId);
    if (!project) {
      return createSuperjsonResponse({ error: 'Project not found' }, { status: 404 });
    }

    const success = project.deleteSession(sessionId);
    if (!success) {
      return createSuperjsonResponse(
        { error: 'Session not found in this project' },
        { status: 404 }
      );
    }

    return createSuperjsonResponse({ success: true });
  } catch (error: unknown) {
    return createSuperjsonResponse(
      { error: error instanceof Error ? error.message : 'Failed to delete session' },
      { status: 500 }
    );
  }
}
