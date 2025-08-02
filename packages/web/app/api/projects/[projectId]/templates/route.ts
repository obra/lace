// ABOUTME: REST API endpoints for project prompt templates - GET all templates, POST new template
// ABOUTME: Uses Project class prompt template manager for business logic and validation

import { NextRequest, NextResponse } from 'next/server';
import { Project } from '@/lib/server/lace-imports';
import { createSuperjsonResponse } from '@/lib/serialization';
import { z } from 'zod';

const CreateTemplateSchema = z.object({
  id: z.string().min(1, 'Template ID is required'),
  name: z.string().min(1, 'Template name is required'),
  description: z.string().optional(),
  content: z.string().min(1, 'Template content is required'),
  variables: z.array(z.string()).optional(),
  parentTemplateId: z.string().optional(),
  isDefault: z.boolean().optional(),
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
      return createSuperjsonResponse({ error: 'Project not found' }, { status: 404 });
    }

    const templates = project.getAllPromptTemplates();

    return createSuperjsonResponse({ templates });
  } catch (error: unknown) {
    const errorMessage = isError(error) ? error.message : 'Failed to fetch templates';
    return createSuperjsonResponse({ error: errorMessage }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
): Promise<NextResponse> {
  try {
    const { projectId } = await params;
    const project = Project.getById(projectId);
    if (!project) {
      return createSuperjsonResponse({ error: 'Project not found' }, { status: 404 });
    }

    const body: unknown = await request.json();
    const validatedData = CreateTemplateSchema.parse(body);

    const template = project.createPromptTemplate({
      id: validatedData.id,
      name: validatedData.name,
      description: validatedData.description,
      content: validatedData.content,
      variables: validatedData.variables,
      parentTemplateId: validatedData.parentTemplateId,
      isDefault: validatedData.isDefault,
    });

    return createSuperjsonResponse({ template: template.toJSON() }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return createSuperjsonResponse(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }

    const errorMessage = isError(error) ? error.message : 'Failed to create template';
    return createSuperjsonResponse({ error: errorMessage }, { status: 500 });
  }
}
