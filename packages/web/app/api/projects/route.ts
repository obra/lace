// ABOUTME: REST API endpoints for project management - GET all projects, POST new project
// ABOUTME: Uses Project class for business logic and validation with proper error handling

import { NextRequest } from 'next/server';
import { Project } from '@/lib/server/lace-imports';
import { createSuperjsonResponse } from '@/lib/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import { z } from 'zod';
import * as Sentry from '@sentry/nextjs';

const CreateProjectSchema = z.object({
  name: z.string().optional(), // Made optional for auto-generation
  description: z.string().optional(),
  workingDirectory: z.string().min(1, 'Working directory is required'),
  configuration: z.record(z.unknown()).optional(),
});

export async function GET() {
  return Sentry.startSpan(
    {
      op: 'http.server',
      name: 'GET /api/projects',
    },
    async (span) => {
      try {
        const projects = Project.getAll();
        span.setAttribute('project.count', projects.length);

        return createSuperjsonResponse(projects);
      } catch (error) {
        Sentry.captureException(error);
        return createErrorResponse(
          error instanceof Error ? error.message : 'Failed to fetch projects',
          500,
          { code: 'INTERNAL_SERVER_ERROR' }
        );
      }
    }
  );
}

export async function POST(request: NextRequest) {
  return Sentry.startSpan(
    {
      op: 'http.server',
      name: 'POST /api/projects',
    },
    async (span) => {
      try {
        const body = (await request.json()) as Record<string, unknown>;
        const validatedData = CreateProjectSchema.parse(body);

        span.setAttribute('project.workingDirectory', validatedData.workingDirectory);
        span.setAttribute('project.hasName', Boolean(validatedData.name));
        span.setAttribute('project.hasDescription', Boolean(validatedData.description));

        const project = Project.create(
          validatedData.name || '', // Pass empty string to trigger auto-generation
          validatedData.workingDirectory,
          validatedData.description || '',
          validatedData.configuration || {}
        );

        const projectInfo = project.getInfo();
        if (projectInfo) {
          span.setAttribute('project.createdId', projectInfo.id);
        }

        return createSuperjsonResponse(projectInfo, { status: 201 });
      } catch (error) {
        Sentry.captureException(error);

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
  );
}
