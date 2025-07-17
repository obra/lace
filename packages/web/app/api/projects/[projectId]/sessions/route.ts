// ABOUTME: Session API endpoints under projects hierarchy - GET sessions by project, POST new session
// ABOUTME: Uses Project class methods for session management with proper project-session relationships

import { NextRequest, NextResponse } from 'next/server';
import { Project } from '@/lib/server/lace-imports';
import { z } from 'zod';

const CreateSessionSchema = z.object({
  name: z.string().min(1, 'Session name is required'),
  description: z.string().optional(),
  configuration: z.record(z.unknown()).optional(),
});

export function GET(_request: NextRequest, { params }: { params: { projectId: string } }) {
  try {
    const project = Project.getById(params.projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const sessions = project.getSessions();

    return NextResponse.json({ sessions });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch sessions' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, { params }: { params: { projectId: string } }) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const validatedData = CreateSessionSchema.parse(body);

    const project = Project.getById(params.projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const session = project.createSession(
      validatedData.name,
      validatedData.description || '',
      validatedData.configuration || {}
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
