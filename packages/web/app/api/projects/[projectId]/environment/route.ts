// ABOUTME: REST API endpoints for project environment variables - GET, PUT operations
// ABOUTME: Uses Project class environment manager for business logic and secure handling

import { NextRequest, NextResponse } from 'next/server';
import { Project } from '@/lib/server/lace-imports';
import { z } from 'zod';

const SetEnvironmentVariablesSchema = z.object({
  variables: z.record(z.string()),
  encrypt: z.array(z.string()).optional(),
});

function isError(error: unknown): error is Error {
  return error instanceof Error;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
): Promise<NextResponse> {
  try {
    const { projectId } = await params;
    const project = Project.getById(projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const variables = project.getEnvironmentVariables();
    
    return NextResponse.json({ variables });
  } catch (error: unknown) {
    const errorMessage = isError(error) ? error.message : 'Failed to fetch environment variables';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
): Promise<NextResponse> {
  try {
    const { projectId } = await params;
    const project = Project.getById(projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const body: unknown = await request.json();
    const validatedData = SetEnvironmentVariablesSchema.parse(body);

    project.setEnvironmentVariables(
      validatedData.variables,
      validatedData.encrypt ? { encrypt: validatedData.encrypt } : undefined
    );

    const updatedVariables = project.getEnvironmentVariables();
    
    return NextResponse.json({ variables: updatedVariables });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }

    const errorMessage = isError(error) ? error.message : 'Failed to update environment variables';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
): Promise<NextResponse> {
  try {
    const { projectId } = await params;
    const project = Project.getById(projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const url = new URL(request.url);
    const key = url.searchParams.get('key');
    
    if (!key) {
      return NextResponse.json({ error: 'Environment variable key is required' }, { status: 400 });
    }

    project.deleteEnvironmentVariable(key);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const errorMessage = isError(error) ? error.message : 'Failed to delete environment variable';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}