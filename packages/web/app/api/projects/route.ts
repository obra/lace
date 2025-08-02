// ABOUTME: REST API endpoints for project management - GET all projects, POST new project
// ABOUTME: Uses Project class for business logic and validation with proper error handling

import { NextRequest } from 'next/server';
import { Project } from '@/lib/server/lace-imports';
import { createSuperjsonResponse } from '@/lib/serialization';
import { z } from 'zod';

const CreateProjectSchema = z.object({
  name: z.string().optional(), // Made optional for auto-generation
  description: z.string().optional(),
  workingDirectory: z.string().min(1, 'Working directory is required'),
  configuration: z.record(z.unknown()).optional(),
});

export async function GET() {
  try {
    const projects = Project.getAll();

    return createSuperjsonResponse({ projects });
  } catch (error) {
    return createSuperjsonResponse(
      { error: error instanceof Error ? error.message : 'Failed to fetch projects' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const validatedData = CreateProjectSchema.parse(body);

    const project = Project.create(
      validatedData.name || '', // Pass empty string to trigger auto-generation
      validatedData.workingDirectory,
      validatedData.description || '',
      validatedData.configuration || {}
    );

    const projectInfo = project.getInfo();

    return createSuperjsonResponse({ project: projectInfo }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createSuperjsonResponse(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }

    return createSuperjsonResponse(
      { error: error instanceof Error ? error.message : 'Failed to create project' },
      { status: 500 }
    );
  }
}
