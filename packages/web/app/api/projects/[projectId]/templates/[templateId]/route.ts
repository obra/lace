// ABOUTME: REST API endpoints for specific project prompt template - GET, PUT, DELETE operations
// ABOUTME: Uses Project class prompt template manager for business logic and validation

import { NextRequest, NextResponse } from 'next/server';
import { Project } from '@/lib/server/lace-imports';
import { createSuperjsonResponse } from '@/lib/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import { z } from 'zod';

const RenderTemplateSchema = z.object({
  variables: z.record(z.string()),
});

function isError(error: unknown): error is Error {
  return error instanceof Error;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; templateId: string }> }
): Promise<NextResponse> {
  try {
    const { projectId, templateId } = await params;
    const project = Project.getById(projectId);
    if (!project) {
      return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const template = project.getPromptTemplate(templateId);
    if (!template) {
      return createErrorResponse('Template not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    return createSuperjsonResponse({ template: template.toJSON() });
  } catch (error: unknown) {
    const errorMessage = isError(error) ? error.message : 'Failed to fetch template';
    return createErrorResponse(errorMessage, 500, { code: 'INTERNAL_SERVER_ERROR' });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; templateId: string }> }
): Promise<NextResponse> {
  try {
    const { projectId, templateId } = await params;
    const project = Project.getById(projectId);
    if (!project) {
      return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const success = project.deletePromptTemplate(templateId);
    if (!success) {
      return createErrorResponse('Template not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    return createSuperjsonResponse({ success: true });
  } catch (error: unknown) {
    const errorMessage = isError(error) ? error.message : 'Failed to delete template';
    return createErrorResponse(errorMessage, 500, { code: 'INTERNAL_SERVER_ERROR' });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; templateId: string }> }
): Promise<NextResponse> {
  try {
    const { projectId, templateId } = await params;
    const project = Project.getById(projectId);
    if (!project) {
      return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const body: unknown = await request.json();
    const validatedData = RenderTemplateSchema.parse(body);

    const renderedContent = project.renderPromptTemplate(templateId, validatedData.variables);

    return createSuperjsonResponse({ renderedContent });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return createSuperjsonResponse(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }

    const errorMessage = isError(error) ? error.message : 'Failed to render template';
    return createErrorResponse(errorMessage, 500, { code: 'INTERNAL_SERVER_ERROR' });
  }
}
