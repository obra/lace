// ABOUTME: REST API endpoints for individual project operations - GET, PATCH, DELETE by project ID
// ABOUTME: Handles project retrieval, updates, and deletion with proper error handling and validation

import { NextRequest } from 'next/server';
import { Project } from '@/lib/server/lace-imports';
import { createSuperjsonResponse } from '@/lib/serialization';
import { z } from 'zod';

const UpdateProjectSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  workingDirectory: z.string().min(1).optional(),
  configuration: z.record(z.unknown()).optional(),
  isArchived: z.boolean().optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const project = Project.getById(projectId);

    if (!project) {
      return createSuperjsonResponse({ error: 'Project not found' }, { status: 404 });
    }

    const projectInfo = project.getInfo();

    return createSuperjsonResponse({ project: projectInfo });
  } catch (error) {
    return createSuperjsonResponse(
      { error: error instanceof Error ? error.message : 'Failed to fetch project' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const validatedData = UpdateProjectSchema.parse(body);

    const project = Project.getById(projectId);

    if (!project) {
      return createSuperjsonResponse({ error: 'Project not found' }, { status: 404 });
    }

    project.updateInfo(validatedData);

    const updatedProjectInfo = project.getInfo();

    return createSuperjsonResponse({ project: updatedProjectInfo });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createSuperjsonResponse(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }

    return createSuperjsonResponse(
      { error: error instanceof Error ? error.message : 'Failed to update project' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const project = Project.getById(projectId);

    if (!project) {
      return createSuperjsonResponse({ error: 'Project not found' }, { status: 404 });
    }

    project.delete();

    return createSuperjsonResponse({ success: true });
  } catch (error) {
    return createSuperjsonResponse(
      { error: error instanceof Error ? error.message : 'Failed to delete project' },
      { status: 500 }
    );
  }
}
