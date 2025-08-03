// ABOUTME: REST API endpoints for project management - GET all projects, POST new project
// ABOUTME: Uses Project class for business logic and validation with proper error handling

import { NextRequest } from 'next/server';
import { Project } from '@/lib/server/lace-imports';
import { createSuperjsonResponse } from '@/lib/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
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
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to fetch projects',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
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
      return createErrorResponse('Invalid request data', 400, {
        code: 'VALIDATION_FAILED',
        details: error.errors,
      });
    }

    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to create project',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}
